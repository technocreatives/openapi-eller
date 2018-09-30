import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import CSharpTarget from "../csharp"
import { resolveSchemaType } from "targets"
import { GenerateArguments } from "types"
import { ParameterObject, RequestBodyObject, SchemaObject } from "openapi3-ts"
import { Operation } from "visitor"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

export default class AspNetTarget extends CSharpTarget {
  generate(args: GenerateArguments) {
    return {
      "Generated.cs": apiTmpl(args)
    }
  }

  returnType(type: string): string {
    if (type === "void") {
      return "void"
    }

    return `JsonResult<${type}>`
  }

  operationParams(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string {
    let x: string[] = []

    if (route.parameters) {
      const params = route.parameters as ParameterObject[]
      x = params.map((p) => {
        const type = resolveSchemaType(this, null, (<SchemaObject>p.schema), p.name)

        const hasQMark = type === "DateTime"
          || (type !== "string" && type.toLowerCase() === type)
          || (<SchemaObject>p.schema).enum

        const suffix = p.required ? "" : " = null"
        // tslint:disable-next-line:max-line-length
        return `[FromUri(Name = "${p.name}")] ${type}${!p.required && hasQMark ? "?" : ""} ${_.camelCase(p.name)}${suffix}`
      })
    }

    if (route.requestBody && (<RequestBodyObject>route.requestBody).content) {
      const k = Object.keys((<RequestBodyObject>route.requestBody).content)[0]
      if (k) {
        const content = (<RequestBodyObject>route.requestBody).content[k]
        // tslint:disable-next-line:max-line-length
        x.push(`${resolveSchemaType(this, null, (<SchemaObject>content.schema), bodyName)} body`)
      }
    }

    if (x.length > 1) {
      return `(\n            ${x.join(",\n            ")})`
    }

    return `(${x.join(", ")})`
  }
}
