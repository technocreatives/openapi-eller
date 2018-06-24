import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers, resolveSchemaType } from "targets"
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
  ServerObject,
  ParameterObject
} from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

const reservedWords = fs.readFileSync(__dirname + "/reserved-words.txt", "utf8").trim().split("\n")

// Identifiers begin with an uppercase or lowercase letter A through Z, 
// an underscore (_), a noncombining alphanumeric Unicode character 
// in the Basic Multilingual Plane, or a character outside the Basic 
// Multilingual Plane that isn’t in a Private Use Area. 
// After the first character, digits and combining Unicode characters are also allowed.
// const validIdentifiers = /^[A-Za-z_][A-Za-z0-9_]*$/;

const upperCamel = _.flow([_.camelCase, _.upperFirst])

export default class SwiftTarget extends Target {
  types: TargetTypeMap = typeResolvers("swift")

  variable(n: string): string {
    const name = n.toString()
    
    if (/^\d+$/.test(name)) {
      if (name === "0") {
        return "zero"
      }
      if (name === "1") {
        return "one"
      }
      
      return _.camelCase(name)
    }

    const hasAt = name.startsWith("@")
    const newName = _.camelCase(name)

    if (reservedWords.indexOf(newName) > -1) {
      return hasAt ? "_" + newName : newName + "_"
    }
   
    return hasAt ? "_" + newName : newName
  }

  cls(name: string, isNested?: boolean | undefined): string {
    const { prefix } = this.config
    const newName = `${prefix || ""}${upperCamel(name)}`

    if (reservedWords.includes(newName)) {
      return newName + "_"
    }

    return newName
  }

  enumKey(key: string): string { return this.variable(key) }

  oneOfKey(key: string): string { return this.variable(key) }

  optional(type: string): string {
    return `${type}?`
  }

  isHashable(type: string): boolean {
    if (type.startsWith("[")) {
      return false
    }
    return true
  }

  operationId(route: SchemaObject): string {
    if (route.operationId) {
      return this.variable(route.operationId)
    }

    return this.variable(route.summary)
  }

  httpMethod(m: string): string {
    return m
  }

  private operationParamsImpl(route: OperationObject,
      bodyName: string, 
      hasDefaults: boolean = false): string {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map((p) => {
      const param = p as ParameterObject
      const schema = param.schema as OpenApiGenSchema
      const variable = this.variable(param.name)
      const type = resolveSchemaType(this, null, schema, param.name)
      return `${variable}: ${type}${param.required ? "" : `?${hasDefaults ? " = nil" : ""}`}`
    })
    
    if (x.length === 0) {
      return ""
    }
    return `${x.join(", ")}`
  }

  operationParams(route: OperationObject, bodyName: string, paramNames: { [key: string]: string }): string {
    return this.operationParamsImpl(route, bodyName)
  }

  operationParamsDefaults(route: OperationObject, bodyName: string): string | undefined {
    return this.operationParamsImpl(route, bodyName, true)
  }

  operationArgs(route: OperationObject, bodyName: string): string | undefined {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map(p => this.variable((<ParameterObject>p).name))
    if (x.length === 0) {
      return ""
    }
    return `(${x.join(", ")})`
  }

  operationKwargs(route: OperationObject, bodyName: string): string | undefined {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map(p => this.variable((<ParameterObject>p).name))
    if (x.length === 0) {
      return ""
    }
    return `(${x.map(xx => `${xx}: ${xx}`).join(", ")})`
  }
  
  requestParams(route: OperationObject, bodyName: string): string | undefined {
    // Generate query params
    const indent = "            "

    if (!route.parameters) {
      throw new Error("No request parameters")
    }

    const q = route.parameters.map((p) => {
      const param = p as ParameterObject
      if (param.in !== "query") {
        return
      }

      return `__params["${param.name}"] = ${this.variable(param.name)}`
    }).filter(x => x != null)
    
    if (q.length > 0) {
      return `
${indent}var __params = [String: Any]()
${indent}${q.join("\n" + indent)}
${indent}return .requestParameters(parameters: __params, encoding: URLEncoding.default)
`.trim()
    }

    return "return .requestPlain"
  }

  fieldDoc(doc: OpenApiGenSchema): string {
    return `// ${doc}`
  }

  modelDoc(doc: OpenApiGenSchema): string {
    return `// ${doc}`
  }

  generate(args: GenerateArguments) {
    return {
      "Generated.swift": apiTmpl(args)
    }
  }

  url(u: string): string {
    return u.replace(/\{(.*?)\}/g, (m, p1) => `\\(${this.variable(p1)})`)
  }

  pathUrl(u: string): string {
    return this.url(u)
  }

  servers(servers: ServerObject[]): TargetServer[] {
    return servers.map((x, i) => ({
      url: this.url(x.url),
      description: this.variable(x.description || `standard${i === 0 ? "" : i}`),
      arguments: _.map(x.variables, (v, k) => {
        return `let ${this.variable(k)}`
      }).join(",\n        "),
      parameters: _.map(x.variables, (v, k) => {
        return `${this.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(x.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: this.variable(k)
        }
      }),
      variables: ""
    }))
  }
}
