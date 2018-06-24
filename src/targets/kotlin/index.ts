import fs from "fs"
import _ from "lodash"

import { typeResolvers, resolveSchemaType, handlebarsInstance } from "targets"
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
  ParameterObject,
  RequestBodyObject
} from "openapi3-ts"

const apiTmpl = handlebarsInstance(`${__dirname}/api.hbs`, `${__dirname}/partials`)
const reservedWords = fs.readFileSync(__dirname + "/reserved-words.txt", "utf8").trim().split("\n")

const validIdentifiers = /^[A-Za-z_][A-Za-z0-9_]*$/
const upperSnake = _.flow([_.snakeCase, _.upperCase, x => x.replace(/\s/g, "_")])
export default class KotlinTarget extends Target {
  types: TargetTypeMap = typeResolvers("kotlin")

  variable(name: string): string {
    const hasAt = name.startsWith("@")
    const newName = `${hasAt ? "_" : ""}${_.camelCase(name)}`

    if (!validIdentifiers.test(newName)) {
      return `\`${newName}\``
    }
   
    return newName
  }

  cls(name: string, isNested?: boolean): string {
    const hasAt = name.startsWith("@")

    const newName = _.flow([_.camelCase, _.upperFirst])(name)
    if (reservedWords.indexOf(newName) > -1) {
      return `\`${hasAt ? "@" + newName : newName}\``
    }
    return hasAt ? "_" + newName : newName
  }

  interface(name: string): string {
    return this.cls(name)
  }

  enum(name: string): string {
    return this.cls(name)
  }

  format(schema: OpenApiGenSchema): string | undefined {
    return schema.format || ""
  }

  enumKey(key: string): string {
    const ks = "" + key
    if (/^\d+/.test(ks)) {
      if (ks === "0") {
        return "ZERO"
      }
      if (ks === "1") {
        return "ONE"
      }
      
      return `_${upperSnake(key)}`
    }

    return upperSnake(key)
  }

  fieldDoc(schema: OpenApiGenSchema): string | undefined {
    // TODO
    return ""
  }

  modelDoc(schema: OpenApiGenSchema): string | undefined {
    // TODO
    return ""
  }

  oneOfKey(key: string): string {
    return this.cls(key)
  }

  optional(type: string): string {
    return `${type}?`
  }
  
  operationId(route: SchemaObject): string {
    if (route.operationId) {
      return this.variable(route.operationId)
    }

    return this.variable(route.summary)
  }

  httpMethod(m: string): string {
    return m.toUpperCase()
  }

  operationParams(route: OperationObject, bodyName: string, paramNames: { [key: string]: string }): string {
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
        default:
          // tslint:disable-next-line:max-line-length
          throw new Error(`Unhandled parameter type: ${param.in}, route: ${JSON.stringify(route.parameters)}`)
        }

        const pn = paramNames[param.name]
        // tslint:disable-next-line:max-line-length
        return `${decorator}("${param.name}") ${this.variable(pn)}: ${resolveSchemaType(this, null, param.schema as SchemaObject, pn)}${param.required ? "" : "? = null"}`
      })
    }

    if (route.requestBody) {
      const requestBody = route.requestBody as RequestBodyObject
      
      if (requestBody.content) {
        const content = requestBody.content
        const k = Object.keys(content)[0]
        // tslint:disable-next-line:max-line-length
        x.push(`@Body body: ${resolveSchemaType(this, null, (<OpenApiGenSchema>content[k].schema), bodyName)}`)
      }
    }

    return `(${x.join(",\n        ")})`
  }

  isHashable(v: string): boolean {
    return true
  }

  generate(args: GenerateArguments) {
    return {
      "Generated.kt": apiTmpl(args)
    }
  }

  url(u: string): string {
    if (!u.endsWith("/")) {
      return `${u}/`
    }
    return u
  }

  pathUrl(u: string): string {
    if (u.startsWith("/")) {
      return u.substring(1)
    }
    return u
  }

  returnType(type: string): string {
    if (type == "Unit") {
      return "Completable"
    }

    return `Single<${type}>`
  }

  servers(s: ServerObject[]): TargetServer[] {
    return s.map((x, i) => ({
      url: this.url(x.url),
      description: this.cls(x.description || `default${i}`),
      variables: _.map(x.variables, (v, k) => {
        // tslint:disable-next-line:max-line-length
        return `val ${this.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(x.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: this.variable(k)
        }
      })
    }))
  }
}
