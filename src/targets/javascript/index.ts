import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"
import { typeResolvers } from "targets"
import { 
  TargetObject, 
  OpenApiGenSchema,
} from "types"
import { ServerObject, ParameterObject, RequestBodyObject } from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(`${__dirname}/api.hbs`, "utf8"))
const tsdTmpl = hbs.compile(fs.readFileSync(`${__dirname}/tsd.hbs`, "utf8"))

const jsTarget: TargetObject = {
  types: typeResolvers("javascript"),
  cls(name) {
    return _.upperFirst(_.camelCase(name))
  },
  enumKey(name) {
    return jsTarget.cls(name)
  },
  variable(name) {
    return _.camelCase(name)
  },
  optional(name) {
    return name
  },
  fieldDoc(doc) {
    return "// " + doc
  },
  modelDoc(doc) {
    return "// " + doc
  },
  interface(name) {
    return jsTarget.cls(name)
  },
  oneOfKey(name) {
    return jsTarget.cls(name)
  },
  isHashable() {
    return false
  },
  enum(name) {
    return jsTarget.cls(name)
  },
  operationId(route) {
    if (route.operationId) {
      return jsTarget.variable(route.operationId)
    }

    return jsTarget.variable(route.summary)
  },
  httpMethod(name) {
    return name.toUpperCase()
  },
  pathUrl(name) {
    return name.replace("{", "${")
  },
  url(thing) {
    return thing.replace("{", "${")
  },
  security(items) {
    return items.map((x) => {
      const prop = Object.keys(x)[0]
      return {
        name: jsTarget.cls(prop),
        values: x[prop]
      }
    })
  },
  requestParams(route) {
    let x: string[] = []

    if (route.parameters) {
      x = route.parameters.filter((p) => {
        return (<ParameterObject>p).in === "query"
      }).map((p) => {
        const v = jsTarget.variable((<ParameterObject>p).name)
        return `if (${v} != null) url.searchParams.set("${(<ParameterObject>p).name}", ${v})`
      })
    }

    if (route.requestBody) {
      const requestBody = route.requestBody as RequestBodyObject
      const mainMime = Object.keys(requestBody.content)[0]

      x.push(`reqBody.headers = { "Content-Type": "${mainMime}" }`)

      if (mainMime.endsWith("form-data")) {
        const bodyContent = requestBody.content[mainMime]
        const schema = bodyContent.schema as OpenApiGenSchema

        if (!schema.properties) {
          throw new Error(`Unexpected structure: Schema properties are mising`)
        }
        // TODO: this should be consistent across platforms
        
        const lines = Object.keys(schema.properties).map((key) => {
          const v = jsTarget.variable(key)

          if (schema.required && schema.required.indexOf(key) > -1) {
            return `formData.append("${key}", body.${v})`
          }

          return `if (${v} != null) {
            formData.append("${key}", body.${v})
          }`
          
        }).join("\n")

        x.push(`
          const formData = new FormData()
          ${lines}
          reqBody.body = formData
        `)
      } else {
        x.push("reqBody.body = JSON.stringify(body)")
      }
    }

    return x.join("\n        ")
  },
  operationParams(route) {
    let x: string[] = []
    
    if (route.parameters) {
      x = route.parameters.map((p) => {
        return `${_.camelCase((<ParameterObject>p).name)}`
      })
    }

    if (route.requestBody) {
      // const k = Object.keys(route.requestBody.content)
      x.push(`body`)
    }

    if (x.length === 0) {
      return "()"
    }
    
    if (x.length === 1) {
      return `(${x[0]})`
    }

    return `({ ${x.join(", ")} })`
  },
  servers(servers: ServerObject[]) {
    return servers.map((server, i) => ({
      url: jsTarget.url(server.url),
      description: jsTarget.variable(server.description || `default${i}`),
      variables: _.map(server.variables, (v, k) => {
        return `${jsTarget.variable(k)}`
      }).join(",\n        "),
      replacements: _.map(server.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: jsTarget.variable(k)
        }
      })
    }))
  },
  generate({ 
    config, 
    security, 
    name, 
    groups, 
    models, 
    servers
  }) {
    const api = apiTmpl({
      config,
      security,
      name,
      groups,
      models,
      servers
    })

    const tsd = tsdTmpl({
      config,
      security,
      name,
      groups,
      models,
      servers
    })

    return {
      "api.js": api,
      "api.d.ts": tsd
    }
  }
}

module.exports = jsTarget
