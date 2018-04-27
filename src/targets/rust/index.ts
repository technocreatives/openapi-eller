import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers } from "targets"
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
  ServerObject
} from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(`${__dirname}/api.hbs`, "utf8"))
const reservedWords = fs.readFileSync(`${__dirname}/reserved-words.txt`, "utf8")
  .trim()
  .split("\n")

export default class RustTarget extends Target {
  types: TargetTypeMap = typeResolvers("rust")

  cls(key: string, isNested?: boolean | undefined): string {
    const candidate = _.upperFirst(_.camelCase(key))
    
    if (reservedWords.includes(candidate)) {
      return `${candidate}_`
    }

    return candidate
  }

  enumKey(string: string): string {
    return this.cls(string)
  }

  oneOfKey(string: string): string {
    return this.cls(string)
  }

  modelDoc(schema: OpenApiGenSchema): string | undefined {
    if (schema.description == null) {
      return
    }

    return `// ${schema.description}`
  }

  fieldDoc(schema: OpenApiGenSchema): string | undefined {
    if (schema.description == null) {
      return
    }
    
    return `// ${schema.description}`
  }

  variable(basename: string): string {
    const candidate = _.snakeCase(basename)
    
    if (reservedWords.includes(candidate)) {
      return `${candidate}_`
    }

    return candidate
  }

  isHashable(type: string): boolean {
    return true
  }

  operationId(route: SchemaObject): string {
    return this.variable(route.operationId || route.summary)
  }

  pathUrl(routePath: string): string {
    return routePath
  }

  httpMethod(method: string): string {
    return method
  }

  url(thing: string): string {
    // TODO
    return thing
  }

  servers(servers: ServerObject[]): TargetServer[] {
    // TODO
    return []
  }

  generate(args: GenerateArguments): { [filename: string]: string; } {
    return { "Generated.rs": apiTmpl(args) }
  }

  operationParams(route: OperationObject, bodyName: string): string {
    return "TODO"
  }
}
