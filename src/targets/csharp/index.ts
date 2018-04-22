import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers, resolveSchemaType } from "targets"
import { TargetObject, OpenApiGenSchema } from "types"
import { ParameterObject } from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

function genComment(indent: number, content: string): string {
  const pre = Array(indent + 1).join(" ")

  return `/// ${content.trim().split("\n").join(`\n${pre}/// `)}`
}

const reservedWords: string[] = []

const csharpTarget: TargetObject = {
  types: typeResolvers("csharp"),
  modelDoc(defn) {
    if (defn.description) {
      return genComment(4, defn.description)
    }
    return ""
  },
  fieldDoc(defn) {
    if (defn.description) {
      return genComment(8, defn.description)
    }
    return ""
  },
  variable(name) {
    return csharpTarget.cls(name)
  },
  cls(name, isNested) {
    const hasAt = name.startsWith("@")
    let candidate

    const newName = _.flow([_.camelCase, _.upperFirst])(name)
    if (reservedWords.indexOf(newName) > -1) {
      candidate = `\`${hasAt ? "@" + newName : newName}\``
    } else {
      candidate = hasAt ? "_" + newName : newName
    }

    return isNested ? `${candidate}Type` : candidate
  },
  enum(name) {
    return `${csharpTarget.cls(name)}Type`
  },
  interface(name) {
    return `I${csharpTarget.cls(name)}`
  },
  enumKey(key) {
    const ks = "" + key
    if (/^\d+$/.test(ks)) {
      if (ks === "0") {
        return "Zero"
      }
      if (ks === "1") {
        return "One"
      }
      
      return csharpTarget.cls("_" + key)
    }
    return csharpTarget.cls(key)
  },
  oneOfKey(key) {
    return csharpTarget.cls(key)
  },
  optional(type) {
    return type
  },
  operationId(route) {
    if (route.operationId) {
      return csharpTarget.variable(route.operationId)
    }

    return csharpTarget.variable(route.summary)
  },
  httpMethod(m) {
    return `Http${_.upperFirst(m)}`
  },
  operationParams(route) {
    if (!route || !route.parameters) {
      throw new Error("Missing parameter information")
    }
    const params = route.parameters as ParameterObject[]
    const x = params.map((p) => {
      // tslint:disable-next-line:max-line-length
      return `${resolveSchemaType(csharpTarget, (<OpenApiGenSchema>p.schema), p.name)} ${_.camelCase(p.name)}`
    })
    return `(${x.join(",\n            ")})`
  },
  isHashable(v) {
    return v !== "string" && v.toLowerCase() === v
  },
  generate({ config, security, name, groups, models, servers }) {
    return {
      // TODO: check if this name is ok
      "api.cs": apiTmpl({
        config,
        security,
        name,
        groups,
        models,
        servers,
      }),
    }
  },
  url(u) {
    if (!u.endsWith("/")) {
      return `${u}/`
    }
    return u
  },
  pathUrl(u) {
    if (u.startsWith("/")) {
      return u.substring(1)
    }
    return u
  },
  servers(s) {
    return s.map((x, i) => ({
      url: csharpTarget.url(x.url),
      description: csharpTarget.cls(x.description || `default${i}`),
      variables: _.map(x.variables, (v, k) => {
        // tslint:disable-next-line:max-line-length
        return `val ${csharpTarget.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(x.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: csharpTarget.variable(k),
        }
      }),
    }))
  },
}

export default csharpTarget
