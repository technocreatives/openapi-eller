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
  ConfigObject
} from "types"
import { 
  PathItemObject, 
  OperationObject, 
  SchemaObject
} from "openapi3-ts"

import { generateModels } from "./models"
import { generateEndpoints } from "./endpoints"

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
// function generateAnonymousModels(
//   tree: OpenApiGenObject, 
//   target: Target,
//   models: { [key: string]: TargetModel }
// ): { [key: string]: TargetModel } {
//   // Search through parameters first

//   const candidateMap = {}

//   _.forEach(tree.paths, (pathObject: PathItemObject, routePath) => {
//     _.forEach(pathObject, (operationObject: OperationObject, httpMethod) => {
//       // if (operationObject.parameters
//     })
//   })
// }

async function start(
  target: string, 
  yamlPath: string, 
  configPath: string,
  targetDir = process.cwd(),
  isDebug = false
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
  // const extraModels = generateAnonymousModels(tree, targetObj, models)
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
