import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers } from "targets"

import {
  Target,
  TargetTypeMap,
  TargetServer,
  GenerateArguments
} from "types"
import {
  SchemaObject,
  ParameterObject,
  ServerObject,
  ReferenceObject
} from "openapi3-ts"

import { resolveSchemaType } from "targets"
import { Operation } from "visitor"

const apiTmpl = hbs.compile(fs.readFileSync(`${__dirname}/api.hbs`, "utf8"))

export default class TypeScriptTarget extends Target {
  types: TargetTypeMap = typeResolvers("typescript")

  cls(name: string): string {
    return _.upperFirst(_.camelCase(name))
  }

  enumKey(name: string): string {
    return this.cls(name)
  }

  variable(name: string): string {
    if (/^[0-9]/.test(name)) {
      return _.camelCase(`_${name}`)
    }
    return _.camelCase(name)
  }

  optional(name: string): string {
    return `${name} | undefined`
  }

  fieldDoc(doc: SchemaObject): string {
    return "// " + doc
  }

  modelDoc(doc: SchemaObject): string {
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
    return name.substring(1) // name.substring(1).replace(/{/g, "${")
  }

  url(thing: string): string {
    const url = thing
    if (url.endsWith("/")) {
      return url
    }
    return `${url}/`
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

  requestParams(route: Operation): string {
    let x: string[] = []

    if (route.parameters) {
      x = route.parameters.filter((p: ParameterObject) => {
        return p.in === "query"
      }).map((p: ParameterObject) => {
        const v = this.variable(p.name)
        return `if (${v} != null) __url.searchParams.set("${p.name}", ${v})`
      })
    }

    const { requestBody } = route

    if (requestBody) {
      const mainMime = route.requestMediaType || "application/json"

      x.push(`__reqBody.headers = { "Content-Type": "${mainMime}" }`)

      if (mainMime.endsWith("form-data")) {
        if (!requestBody.properties) {
          throw new Error(`Unexpected structure: Schema properties are mising`)
        }
        // TODO: this should be consistent across platforms

        const lines = Object.keys(requestBody.properties).map((key) => {
          const v = this.variable(key)

          if (requestBody.required && requestBody.required.indexOf(key) > -1) {
            return `__formData.append("${key}", body.${v})`
          }

          return `if (${v} != null) {
            __formData.append("${key}", body.${v})
          }`

        }).join("\n")

        x.push(`
          const __formData = new FormData()
          ${lines}
          __reqBody.body = __formData
        `)
      } else {
        x.push("__reqBody.body = JSON.stringify(body)")
      }
    }

    return x.join("\n    ")
  }

  private isParameterObject(p: ParameterObject | ReferenceObject): p is ParameterObject {
    return typeof (p as any).$ref === "undefined"
  }

  operationParams(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string {
    let x: string[] = []

    if (route.parameters) {
      x = route.parameters.map((p) => {
        const param = p as ParameterObject
        let decorator

        switch (param.in) {
        case "path":
          decorator = "@Path"
          break
        case "query":
          decorator = "@Query"
          break
        case "header":
          decorator = "@Header"
          break
        default:
          // tslint:disable-next-line:max-line-length
          throw new Error(`Unhandled parameter type: ${param.in}, route: ${JSON.stringify(route.parameters)}`)
        }

        const pn = paramNames[param.name]
        // tslint:disable-next-line:max-line-length
        return `${decorator}("${param.name}") ${this.variable(pn)}${param.required ? "" : "?"}: ${resolveSchemaType(this, null, param.schema as SchemaObject, pn)}`
      })
    }

    const { requestBody } = route
    if (requestBody != null) {
      x.push(`@Body(BodyType.JSON) body: ${resolveSchemaType(this, null, requestBody, bodyName)}`)
    }

    return `(${x.join(",\n        ")})`
  }

  returnType(type: string): string {
    return `Promise<${type}>`
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
    return { "Generated.ts": apiTmpl(args) }
  }
}
