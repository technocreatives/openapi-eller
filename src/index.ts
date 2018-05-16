import jref from "json-ref-lite"
import yaml from "js-yaml"
import fs from "fs"
import _ from "lodash"
import { 
  OpenApiGenTree, 
  OpenApiGenSchema,
  SecuritySchemeType, 
  Target, 
  ParameterLocation, 
  SecuritySchemeObjectScheme,
  TargetSecuritySchemes,
  ConfigObject,
  GenerateArguments
} from "./types"
import {
  SchemaObject,
  ParameterObject
} from "openapi3-ts"

import { generateModels } from "./models"
import { generateEndpoints, endpointIterator } from "./endpoints"
import { resolveTarget } from "./targets"

function parseOpenApiGenTree(tree: OpenApiGenTree) {
  if (!tree.servers) {
    throw new Error(`Unexpected structure: Servers missing`)
  }

  // Add keys to schemas
  if (tree && tree.components) {
    const { schemas, parameters } = tree.components

    if (schemas != null) {
      for (const k in schemas) {
        const schema = schemas[k]

        if (schema.type !== "array" && schema.type !== "object" && schema.enum == null) {
          continue
        }

        schemas[k].key = k

        // Ensure titles have known origins
        if (schemas[k].title) {
          schemas[k].hasModelTitle = true
        }
      }
    }

    if (parameters != null) {
      for (const k in parameters) {
        const schema = parameters[k].schema as OpenApiGenSchema | undefined

        if (schema != null) {
          if (schema.type !== "array" && schema.type !== "object" && schema.enum == null) {
            continue
          }

          (schema as OpenApiGenSchema).key = k
          // logger.warn(`parameter keyed: ${k}`)
        }
      }
    }
  }

  // Add parameters to methods
  for (const { operationObject, pathObject } of endpointIterator(tree)) {
    const params = pathObject.parameters || []
    operationObject.parameters = params.concat(operationObject.parameters || [])
    
    for (const defn of operationObject.parameters as ParameterObject[]) {
      const param = defn as ParameterObject

      if (param.schema != null) {
        const schema = param.schema as OpenApiGenSchema

        if (schema.type === "object" || schema.type === "array" || schema.enum != null) {
          if (operationObject.operationId == null) {
            throw new Error("No operationId found for " + JSON.stringify(operationObject))
          }
          
          schema.key = `${operationObject.operationId}_${param.name}`
          // logger.warn(`parameter keyed: ${operationObject.key}`)
        }
      }
    }
  }

  // Resolve $refs
  tree = jref.resolve(tree) as OpenApiGenTree

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
  tree: OpenApiGenTree, 
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
    const { type } = securitySchemeObject

    if (type === SecuritySchemeType.OAuth2 || type === SecuritySchemeType.OpenIdConnect) {
      if (securitySchemeObject.flows == null) {
        throw new Error("Flows can not be null with oauth2 security scheme")
      }

      const isOpenIdConnect = type === SecuritySchemeType.OpenIdConnect

      Object.keys(securitySchemeObject.flows).forEach((fk) => {
        if (!securitySchemeObject.flows) {
          return
        }

        const o: TargetSecuritySchemes = Object.assign({}, securitySchemeObject.flows[fk], {
          name: target.cls(`${k}_${fk}`),
          isOAuth2: true,
          isOpenIdConnect,
          isAuthorizationCode: fk === "authorizationCode",
          isImplicit: fk === "implicit",
          scopes: _.map(securitySchemeObject.flows[fk].scopes, (v, k) => ({
            name: target.enumKey(k),
            value: k
          }))
        })

        if (isOpenIdConnect) {
          o.openIdConnectUrl = securitySchemeObject.openIdConnectUrl
        }

        security.push(o)
      })
    } else if (type === SecuritySchemeType.ApiKey) {
      security.push({
        name: target.cls(k),
        key: securitySchemeObject.name,
        isApiKey: true,
        inHeader: securitySchemeObject.in === ParameterLocation.Header,
        inQuery: securitySchemeObject.in === ParameterLocation.Query
      })
    } else if (type === SecuritySchemeType.HTTP) {
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

async function generateTemplateData(
  target: Target,
  tree: OpenApiGenTree,
  config: any
): Promise<GenerateArguments> {
  if (tree.openapi == null || !tree.openapi.startsWith("3.")) {
    throw new Error("Did not find supported version or `openapi` field.")
  }

  const models = generateModels(tree, target)
  const groups = generateEndpoints(tree, target, config)

  const data = {
    config,
    groups,
    models,
    security: generateSecuritySchemes(tree, target),
    servers: target.servers(tree.servers),
    name: target.cls(tree.info.title)
  }

  return data
}

export async function generateArgumentsFromTree(
  target: Target,
  unparsedTree: OpenApiGenTree,
  config: any 
): Promise<GenerateArguments> {
  const tree = parseOpenApiGenTree(unparsedTree)
  return generateTemplateData(target, tree, config)
}

export function loadConfig(configPath: string | undefined): ConfigObject {
  let config = {}
  if (configPath != null) {
    if (!fs.statSync(configPath)) {
      throw new Error("Config file does not exist")
    }
    config = JSON.parse(fs.readFileSync(configPath, "utf8"))
  }
  return config
}

export function loadTarget(targetName: string, config: ConfigObject): Target {
  const targetClass = resolveTarget(targetName) as (new (config: ConfigObject) => Target) | null
  if (targetClass == null) {
    throw new Error(`No target found for name: ${targetName}`)
  }
  return new targetClass(config)
}

export async function generateArgumentsFromPath(
  target: Target,
  yamlPath: string, 
  config: any
): Promise<GenerateArguments> {
  if (!fs.statSync(yamlPath)) {
    throw new Error("YAML file does not exist")
  }

  // const target = loadTarget(targetName, config)
  const unparsedTree = yaml.safeLoad(fs.readFileSync(yamlPath, "utf8")) as OpenApiGenTree
  const generateArgs = await generateArgumentsFromTree(target, unparsedTree, config)

  return generateArgs
}
