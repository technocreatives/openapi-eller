import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

// import { typeResolvers } from "targets"
import {
  Target,
  OpenApiGenSchema,
  TargetTypeMap,
  TargetServer,
  GenerateArguments
} from "types"
import {
  SchemaObject,
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  ServerObject,
  ReferenceObject
} from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(`${__dirname}/api.hbs`, "utf8"))

export default class EcmaScriptTarget extends Target {
  types: TargetTypeMap = new Proxy({}, {
    get(target: any, propertyKey: PropertyKey, receiver: any) {
      if (typeof propertyKey === "string" && ["null", "map", "set", "array"].includes(propertyKey)) {
        return ""
      }
      return new Proxy({}, {
        get(target: any, propertyKey: PropertyKey, receiver: any) {
          return ""
        }
      })
    }
  })

  cls(name: string): string {
    return _.upperFirst(_.camelCase(name))
  }

  enumKey(name: string): string {
    return this.cls(name)
  }

  variable(name: string): string {
    return _.camelCase(name)
  }

  optional(name: string): string {
    return name
  }

  fieldDoc(doc: OpenApiGenSchema): string {
    return "// " + doc
  }

  modelDoc(doc: OpenApiGenSchema): string {
    return "// " + doc
  }

  interface(name: string): string {
    return this.cls(name)
  }

  oneOfKey(name: string): string {
    return this.cls(name)
  }

  isHashable(type: string): boolean {
    return false
  }

  enum(name: string): string {
    return this.cls(name)
  }

  operationId(route: SchemaObject): string {
    if (route.operationId) {
      return this.variable(route.operationId)
    }

    return this.variable(route.summary)
  }

  httpMethod(name: string): string {
    return name.toUpperCase()
  }

  pathUrl(name: string): string {
    return name.replace(/{/g, "${")
  }

  url(thing: string): string {
    return thing.replace(/{/g, "${")
  }
  
  // security(items) {
  //   return items.map((x) => {
  //     const prop = Object.keys(x)[0]
  //     return {
  //       name: jsTarget.cls(prop),
  //       values: x[prop]
  //     }
  //   })
  // },
  
  requestParams(route: SchemaObject): string {
    let x: string[] = []

    if (route.parameters) {
      x = route.parameters.filter((p: ParameterObject) => {
        return p.in === "query"
      }).map((p: ParameterObject) => {
        const v = this.variable(p.name)
        return `if (${v} != null) url.searchParams.set("${p.name}", ${v})`
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
          const v = this.variable(key)

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
  }

  private isParameterObject(p: ParameterObject | ReferenceObject): p is ParameterObject {
    return typeof (p as any).$ref === "undefined"
  }

  operationParams(route: OperationObject, bodyName: string) {
    let x: string[] = []
    
    if (route.parameters) {
      x = route.parameters
        .filter(this.isParameterObject)
        .map((p) => `${_.camelCase(p.name)}`)
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
  }

  servers(servers: ServerObject[]): TargetServer[] {
    return servers.map((server, i) => ({
      url: this.url(server.url),
      description: this.variable(server.description || `default${i}`),
      variables: _.map(server.variables, (v, k) => {
        return `${this.variable(k)}`
      }).join(",\n        "),
      replacements: _.map(server.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: this.variable(k)
        }
      })
    }))
  }

  generate(args: GenerateArguments): { [filename: string]: string } {
    return { "Generated.js": apiTmpl(args) }
  }
}
