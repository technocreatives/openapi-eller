import yaml from "js-yaml"
import fs from "fs"
import _ from "lodash"
import {
  SecuritySchemeType,
  Target,
  ParameterLocation,
  SecuritySchemeObjectScheme,
  TargetSecuritySchemes,
  ConfigObject,
  GenerateArguments
} from "./types"

import { generateEndpoints } from "./endpoints"
import { resolveTarget } from "./targets"
import { GeneratorVisitor, ModelGenerator } from "./visitor"
// import logger from "winston"

function generateSecuritySchemes(
  target: Target
): {}[] {
  const { tree } = target.visitor
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
          : false,
        isBearer: securitySchemeObject.scheme
          ? securitySchemeObject.scheme.toLowerCase() === SecuritySchemeObjectScheme.Bearer
          : false
        // TODO: security schemes might be functoins
      })
    } else {
      throw new Error(`Unhandled security scheme: ${JSON.stringify(securitySchemeObject)}`)
    }
  })

  return security
}

export async function generateArgumentsFromTarget(
  target: Target
): Promise<GenerateArguments> {
  const { visitor, config } = target
  visitor.start()

  // visitor.schemas.forEach((ctx) => {
  //   console.log(ctx.toString(visitor))
  // })

  const modelGenerator = new ModelGenerator(target, visitor)

  const models = modelGenerator.generate() // generateModels(tree, target)
  const groups = generateEndpoints(target)
  const { servers } = visitor.tree

  const data = {
    config,
    groups,
    models,
    security: generateSecuritySchemes(target),
    servers: servers != null ? target.servers(servers) : [],
    name: target.cls(visitor.tree.info.title)
  }

  return data
}

export function loadConfig(configPath: string | undefined): ConfigObject {
  let config = {}
  if (configPath != null) {
    if (!fs.statSync(configPath)) {
      throw new Error("Config file does not exist")
    }
    const result = yaml.safeLoad(fs.readFileSync(configPath, "utf8"))
    if (result != null) {
      config = result
    } else {
      throw new Error("Config file is empty")
    }
  }
  return config
}

export async function loadTarget(targetName: string, yamlPath: string, config: ConfigObject): Promise<Target> {
  const unparsedTree = yaml.safeLoad(fs.readFileSync(yamlPath, "utf8"))
  const visitor = await GeneratorVisitor.create(unparsedTree)

  type TargetClass = new (visitor: GeneratorVisitor, config: ConfigObject) => Target
  const targetClass = resolveTarget(targetName) as TargetClass | null
  if (targetClass == null) {
    throw new Error(`No target found for name: ${targetName}`)
  }
  return new targetClass(visitor, config)
}
