import jref from "json-ref-lite"
import yaml from "js-yaml"
import fs from "fs"
import _ from "lodash"
import { sync as mkdirpSync } from "mkdirp"
import path from "path"
import { 
  OpenApiGenObject, 
  SecuritySchemeType, 
  Target, 
  ParameterLocation, 
  SecuritySchemeObjectScheme,
  TargetSecuritySchemes,
  TargetModel,
  OpenApiGenSchema,
  TargetField,
  EnumObject,
  EnumObjectType,
  ConfigObject,
  TargetEndpointsGroup,
} from "types"
import { 
  PathItemObject, 
  OperationObject, 
  SchemaObject,
  ResponseObject,
  ResponsesObject
} from "openapi3-ts"

const { resolveSchemaType, resolveType } = require("./targets")

function loadYamlFile(yamlFilePath: string) {
  if (!fs.statSync(yamlFilePath)) {
    throw new Error("YAML file does not exist")
  }

  let tree = yaml.safeLoad(fs.readFileSync(yamlFilePath, "utf8")) as OpenApiGenObject

  // Add keys to schemas
  if (tree && tree.components && tree.components.schemas) {
    const schemas = tree.components.schemas

    Object.keys(schemas).forEach((k) => {
      schemas[k].key = k

      // Ensure titles have known origins
      if (schemas[k].title) {
        schemas[k].hasModelTitle = true
      }
    })
  }

  // Add parameters to methods
  _.forEach(tree.paths, (pathItemObject: PathItemObject, routePath: string) => {
    const params = pathItemObject.parameters || []
    
    _.forEach(pathItemObject, (defn: OperationObject, httpMethod: string) => {
      if (httpMethod === "parameters") {
        return
      }

      defn.parameters = params.concat(defn.parameters || [])
    })
  })

  // Resolve $refs
  tree = jref.resolve(tree) as OpenApiGenObject

  // Merge all "allOf"
  if (tree.components && tree.components.schemas) {
    Object.keys(tree.components.schemas).forEach((k) => {
      if (!tree || !tree.components || !tree.components.schemas) {
        return
      }
      const schema = tree.components.schemas[k]
      if (schema.properties) {
        Object.keys(schema.properties).forEach((k) => {
          if (!schema.properties) {
            return
          }
          const prop = schema.properties[k] as SchemaObject

          if (prop.allOf) {
            schema.properties[k] = Object.assign({}, ...prop.allOf)
          }
        })
      }
    })
  }

  return tree
}

function generateSecuritySchemes(
  tree: OpenApiGenObject, 
  target: Target
): {}[] {
  const security: TargetSecuritySchemes[] = []

  if (tree.components == null || tree.components.securitySchemes == null) {
    return security
  }

  Object.keys(tree.components.securitySchemes).forEach((k) => {
    if (!tree || !tree.components || !tree.components.securitySchemes) {
      return
    }
    const securitySchemeObject = tree.components.securitySchemes[k]

    if (securitySchemeObject.type === SecuritySchemeType.OAuth2
      && securitySchemeObject.flows) {

      Object.keys(securitySchemeObject.flows).forEach((fk) => {
        if (!securitySchemeObject.flows) {
          return
        }
        const o = Object.assign({}, securitySchemeObject.flows[fk], {
          name: target.cls(`${k}_${fk}`),
          isOAuth2: true,
          isAuthorizationCode: fk === "authorizationCode",
          scopes: _.map(securitySchemeObject.flows[fk].scopes, (v, k) => ({
            name: target.enumKey(k),
            value: k
          }))
        })

        security.push(o)
      })
    } else if (securitySchemeObject.type === SecuritySchemeType.ApiKey) {
      security.push({
        name: target.cls(k),
        key: securitySchemeObject.name,
        isApiKey: true,
        inHeader: securitySchemeObject.in === ParameterLocation.Header,
        inQuery: securitySchemeObject.in === ParameterLocation.Query
      })
    } else if (securitySchemeObject.type === SecuritySchemeType.HTTP) {
      security.push({
        name: target.cls(k),
        isHttp: true,
        isBasic: securitySchemeObject.scheme 
          ? securitySchemeObject.scheme.toLowerCase() === SecuritySchemeObjectScheme.Basic 
          : false,
        isDigest: securitySchemeObject.scheme
          ? securitySchemeObject.scheme.toLowerCase() === SecuritySchemeObjectScheme.Digest
          : false
        // TODO: security schemes might be functoins
      })
    } else {
      throw new Error(`Unhandled security scheme: ${JSON.stringify(securitySchemeObject)}`)
    }
  })

  return security
}

function generateModels(
  tree: OpenApiGenObject, 
  target: Target
): { [key: string]: TargetModel } {
  if (!tree || tree.components == null) {
    return {}
  }

  const { schemas } = tree.components

  if (schemas == null) {
    return {}
  }

  const models: { [key: string]: TargetModel} = {}
  const interfaces: {[key: string]: string[]} = {}

  // TODO: anonymous request body

  Object.keys(schemas).forEach((schemaKey) => {
    const schema = schemas[schemaKey]

    if (schema.enum) {
      models[schema.key] = {
        name: target.cls(schema.key),
        type: "enum",
        isEnum: true,
        values: schema.enum.map((x: string) => ({
          key: target.enumKey(x),
          value: x
        })),
        interfaces: [],
        fields: {},
        enums: {},
        doc: ""
      }

      return
    }

    if (schema.type === "array") {
      // tslint:disable-next-line:max-line-length
      throw new Error(schema.key + ": Array models cannot be represented in most programming languages. Prefer an object and use the `items` property to generate a representable version of this model.")
    }

    // Basic model

    if (!schema.properties) {
      throw new Error(`No properties found for schema '${schema.key}'`)
    }

    const fields: { [key: string]: TargetField } = Object.keys(schema.properties).reduce((
      fieldObject: { [key: string]: TargetField },
      key: string
    ) => {
      if (!schema.properties) {
        return {}
      }
      const prop = schema.properties[key] as OpenApiGenSchema
      const baseName = prop.title || key

      const type = resolveType(target, schema, key, prop)

      let name
      if (target.config
        && target.config.fieldRenames 
        && target.config.fieldRenames[schema.key] 
        && target.config.fieldRenames[schema.key][key]) {

        name = target.config.fieldRenames[schema.key][key]
      } else {
        name = target.variable(baseName)
      }

      fieldObject[key] = {
        name,
        type,
        key,
        doc: target.fieldDoc(prop),
        isHashable: target.isHashable(type),
        isEnum: prop.enum != null,
        isOneOf: prop.oneOf != null,
        isOptional: schema.required ? schema.required.indexOf(key) < 0 : true,
        format: target.format(prop),
        isNameEqualToKey: false
      }

      fieldObject[key].isNameEqualToKey = fieldObject[key].name === key

      return fieldObject
    }, {})

    // Inner enums
    const schemaProperties = schema.properties as {[propertyName: string]: OpenApiGenSchema}
    const enums: {[key: string]: EnumObject} = Object.keys(schemaProperties)
      .filter(k => (schemaProperties[k].enum &&
          !schemaProperties[k].key) ||
          schemaProperties[k].oneOf)
      .reduce((enumAcc: {[key: string]: EnumObject}, key) => {
        const baseName = (<OpenApiGenSchema>schemaProperties[key]).title || key
        let name = ""
        let enumObject: EnumObject | null = null

        const oneOf = schemaProperties[key].oneOf as OpenApiGenSchema[]
        const enumDef = schemaProperties[key].enum
        
        if (oneOf && oneOf[0]) {
          name = target.interface(baseName) || baseName
          // There's a bug with the OpenAPI specification that doesn't allow string discriminators
          const discriminator = schemaProperties[key].discriminator as any as string
          const oneOfProperties = oneOf[0].properties
          let firstOne: OpenApiGenSchema | undefined
          
          if (oneOfProperties && discriminator) {
            firstOne = oneOfProperties[discriminator] as OpenApiGenSchema
          }
          const values = oneOf.map((o) => {
            const v = {
              key: target.oneOfKey(o.key),
              type: resolveType(target, schema, key, o),
              value: o.key
            }

            // Mark interfaces on targets
            if (interfaces[v.type] == null) {
              interfaces[v.type] = []
            }

            // TODO: nestedInterface func
            interfaces[v.type].push(`${target.cls(schema.key)}.${name}`)

            return v
          })

          if (firstOne) {
            enumObject = {
              name,
              discriminator,
              values,
              type: EnumObjectType.OneOf,
              isOneOf: true,
              isEnum: false,
              discriminatorType: firstOne.key,
              discriminatorVariable: target.variable(discriminator)
            }
          } else {
            // tslint:disable-next-line:max-line-length
            throw new Error(`Object with oneOf definition is lacking a discriminator: ${schema.key}`)
          }
        } else if (enumDef) {
          // TODO: check if this is ok name in case enum method is missing
          name = target.enum ? target.enum(baseName) : baseName
          enumObject = {
            name,
            type: EnumObjectType.Enum,
            isEnum: true,
            isOneOf: false,
            values: enumDef.map(x => ({
              key: target.enumKey(x),
              value: x
            }))
          }
        }
        
        if (enumObject) {
          enumAcc[name] = enumObject
        }

        return enumAcc
      }, {})

    // Nested objects...

    Object.keys(schemaProperties)
      .filter(k => schemaProperties[k].type === "object" && schemaProperties[k].key == null)
      .forEach((k) => {
        console.error(`${schema.key}:${k}: unhandled nested object`)
      })

    Object.keys(schemaProperties)
      .filter((k) => {
        const obj = schemaProperties[k]
        const isArray = obj.type === "array"

        if (!isArray) {
          return false
        }

        if (!obj.items) {
          return false
        }
        
        const itemsEnum = (<OpenApiGenSchema>obj.items).enum
        if (!itemsEnum) {
          return false
        }

        // TODO: check why are we checking if the enum object which is an array has a key property?
        // const enumHasNoKey = typeof itemsEnum.key === "undefined";

        return isArray /* && enumHasNoKey*/
      })
      .reduce((o, key) => {
        let baseName = key
        const schema = schemaProperties[key]
        const items = (<OpenApiGenSchema>schema.items)
        if (items && items.title) {
          baseName = items.title as string
        }
        // TODO: check if this is ok name in case enum method is missing
        const name = target.enum ? target.enum(baseName) : baseName

        if (!items.enum) {
          return o
        }

        o[name] = {
          name,
          type: EnumObjectType.Enum,
          isEnum: true,
          isOneOf: false,
          values: items.enum.map(x => ({
            key: target.enumKey(x),
            value: x
          }))
        }
        return o
      }, enums)

    let name = target.cls(schemaKey)
    if (target.config
      && target.config.renames 
      && target.config.renames[name]
    ) {
      name = target.config.renames[name]
    }
    
    const doc = target.modelDoc(schema)
    // TODO: check what the type field is!
    models[name] = { 
      name, 
      fields, 
      enums, 
      doc,
      type: "",
      isEnum: false,
      values: [],
      interfaces: []
    }
  })

  Object.keys(interfaces).forEach((k) => {
    models[k].interfaces = interfaces[k]
  })

  return jref.resolve(models) as { [key: string]: TargetModel }
}

function generateEndpoints(
  tree: OpenApiGenObject, 
  target: Target, 
  config: ConfigObject
): TargetEndpointsGroup[] | null {
  const isGroupingEnabled = config.useGroups || false

  const findResponseSchema = (responses: ResponsesObject) => {
    const successResponse: ResponseObject = _.find(
      responses, 
      (responseObject: ResponseObject, statusCode) => {
        const statusCodeInt = parseInt(statusCode, 10)

        if (Number.isNaN(statusCodeInt)) {
          return false
        }

        return statusCodeInt >= 200 && statusCodeInt <= 299
      })
    
    if (!successResponse) {
      return null
    }
    
    const successResponseContent = successResponse.content

    if (!successResponseContent) {
      return null
    }

    const firstObject = _.find(successResponseContent)
    if (!firstObject) {
      return null
    }
    // Get first object by key.
    return firstObject.schema
  }

  const groups: {[groupName: string]: TargetEndpointsGroup} = {}

  _.forEach(tree.paths, (pathObject: PathItemObject, routePath) => {
    return _.forEach(pathObject, (operationObject: OperationObject, httpMethod) => {
      if (
        httpMethod === "parameters"
          || httpMethod === "description"
          || httpMethod === "summary"
          || httpMethod === "servers"
      ) {
        return null
      }

      if (config && config.include) {
        if (!operationObject.tags) {
          return null
        }

        const include = config.include
        if (!operationObject.tags.find((tag: string) => include.indexOf(tag) > -1)) {
          return null
        }
      }

      // Group routes by first tag if grouping is enabled
      const group = isGroupingEnabled && operationObject.tags 
        ? target.cls(operationObject.tags[0]) 
        : ""
      
      if (!operationObject.responses) {
        throw new Error(`No responses field found for ${JSON.stringify(operationObject)}`)
      }

      let responseSchema
      try {
        responseSchema = findResponseSchema(operationObject.responses)
      } catch (err) {
        throw new Error(`Invalid response found for ${JSON.stringify(operationObject)}`)
      }

      if (!operationObject.operationId && !operationObject.summary) {
        // tslint:disable-next-line:max-line-length
        throw new Error(`No operationId or summary found for route: ${JSON.stringify(operationObject)}`)
      }
      const operationId = target.operationId(operationObject)
      const anonymousReqBodyName = `${target.cls(operationId)}Body`
      const anonymousResponseName = `${target.cls(operationId)}Response`
      const schemaType = resolveSchemaType(target, responseSchema, anonymousResponseName)
      const returnType = target.returnType ? target.returnType(schemaType) : schemaType

      if (!groups[group]) {
        groups[group] = {
          name: group,
          endpoints: []
        }
      }

      const opParamDefaults = target.operationParamsDefaults(operationObject, anonymousReqBodyName)
        || target.operationParams(operationObject, anonymousReqBodyName)

      groups[group].endpoints.push({
        operationId,
        returnType,
        httpMethod: target.httpMethod(httpMethod),
        url: target.pathUrl(routePath),
        // security: target.security
        //     ? target.security(operationObject.security || [])
        //     : null,
        operationParams: target.operationParams(operationObject, anonymousReqBodyName),
        operationParamsDefaults: opParamDefaults,
        operationArgs: target.operationArgs(operationObject, anonymousReqBodyName),
        operationKwargs: target.operationKwargs(operationObject, anonymousReqBodyName),
        requestParams: target.requestParams(operationObject, anonymousReqBodyName)
      })
    })
  })

  return _.map(groups, v => v)
}

async function start(
  target: string, 
  yamlPath: string, 
  configPath: string, 
  targetDir = process.cwd()
) {
  let config = {}
  if (configPath != null) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  }
  // TODO: can throw, need to handle
  const tree = loadYamlFile(yamlPath)

  if (tree.openapi == null || !tree.openapi.startsWith("3.")) {
    throw new Error("Did not find supported version or `openapi` field.")
  }

  const targetClass = require(`${__dirname}/targets/${target}`).default as
    new (config: ConfigObject) => Target
  const targetObj = new targetClass(config)
  const models = generateModels(tree, targetObj)
  const groups = generateEndpoints(tree, targetObj, config)

  if (!tree.servers) {
    throw new Error(`Unexepcted structure: Servers missing`)
  }

  const data = {
    config,
    groups,
    models,
    security: generateSecuritySchemes(tree, targetObj),
    servers: targetObj.servers(tree.servers),
    name: targetObj.cls(tree.info.title)
  }

  
  fs.writeFileSync("debug.json", JSON.stringify(data, null, 2), "utf8")

  const files = targetObj.generate(data)

  for (const fn in files) {
    const nfn = path.join(targetDir, fn)
    mkdirpSync(path.dirname(nfn))
    fs.writeFileSync(nfn, files[fn], "utf8")
  }
}

module.exports = start
