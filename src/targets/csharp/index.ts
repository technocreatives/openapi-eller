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
const titleCamel = (x: string) => _.upperFirst(_.camelCase(x))

function genComment(indent: number, content: string): string {
  const pre = Array(indent + 1).join(" ")

  return `/// ${content.trim().split("\n").join(`\n${pre}/// `)}`
}

const reservedWords: string[] = []

export default class CSharpTarget extends Target {
  types: TargetTypeMap = typeResolvers("csharp")

  modelDoc(defn: OpenApiGenSchema): string | undefined {
    if (defn.description) {
      return genComment(4, defn.description)
    }
    return ""
  }

  fieldDoc(defn: OpenApiGenSchema): string | undefined {
    if (defn.description) {
      return genComment(8, defn.description)
    }
    return ""
  }

  variable(name: string): string {
    return this.cls(name)
  }

  cls(name: string, isNested?: boolean | undefined): string {
    const hasAt = name.startsWith("@")
    let candidate

    const newName = titleCamel(name)
    if (reservedWords.indexOf(newName) > -1) {
      candidate = `\`${hasAt ? "@" + newName : newName}\``
    } else {
      candidate = hasAt ? "_" + newName : newName
    }

    return isNested ? `${candidate}Type` : candidate
  }

  enum(name: string): string {
    return `${this.cls(name)}Type`
  }

  interface(name: string): string {
    return `I${this.cls(name)}`
  }

  enumKey(key: string): string {
    const ks = "" + key
    if (/^\d+$/.test(ks)) {
      if (ks === "0") {
        return "Zero"
      }
      if (ks === "1") {
        return "One"
      }
      
      return this.cls("_" + key)
    }
    return this.cls(key)
  }

  oneOfKey(key: string): string {
    return this.cls(key)
  }

  optional(type: string): string {
    return type
  }

  operationId(route: SchemaObject): string {
    if (route.operationId) {
      return this.variable(route.operationId)
    }

    return this.variable(route.summary)
  }

  httpMethod(m: string): string {
    return `Http${_.upperFirst(m)}`
  }

  operationParams(route: OperationObject, bodyName: string): string {
    if (!route || !route.parameters) {
      throw new Error("Missing parameter information")
    }
    const params = route.parameters as ParameterObject[]
    const x = params.map((p) => {
      // tslint:disable-next-line:max-line-length
      return `${resolveSchemaType(this, (<OpenApiGenSchema>p.schema), p.name)} ${_.camelCase(p.name)}`
    })
    return `(${x.join(",\n            ")})`
  }

  isHashable(v: string): boolean {
    return v !== "string" && v.toLowerCase() === v
  }

  generate(args: GenerateArguments) {
    return {
      "Generated.cs": apiTmpl(args)
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

