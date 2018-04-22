import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers, resolveSchemaType } from "targets"
import { TargetObject, OpenApiGenSchema } from "types"
import { ParameterObject, RequestBodyObject } from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

const reservedWords = fs.readFileSync(__dirname + "/reserved-words.txt", "utf8").trim().split("\n")

const validIdentifiers = /^[A-Za-z_][A-Za-z0-9_]*$/
const upperSnake = _.flow([_.snakeCase, _.upperCase, x => x.replace(/\s/g, "_")])
const kotlinTarget: TargetObject = {
  types: typeResolvers("kotlin"),
  variable(name) {
    const hasAt = name.startsWith("@")
    const newName = `${hasAt ? "_" : ""}${_.camelCase(name)}`

    if (!validIdentifiers.test(newName)) {
      return `\`${newName}\``
    }
   
    return newName
  },
  cls(name) {
    const hasAt = name.startsWith("@")

    const newName = _.flow([_.camelCase, _.upperFirst])(name)
    if (reservedWords.indexOf(newName) > -1) {
      return `\`${hasAt ? "@" + newName : newName}\``
    }
    return hasAt ? "_" + newName : newName
  },
  interface(name) {
    return kotlinTarget.cls(name)
  },
  enum(name) {
    return kotlinTarget.cls(name)
  },
  format(prop) {
    return prop.format || ""
  },
  enumKey(key) {
    const ks = "" + key
    if (/^\d+$/.test(ks)) {
      if (ks === "0") {
        return "ZERO"
      }
      if (ks === "1") {
        return "ONE"
      }
      
      return upperSnake("_" + key)
    }
    return upperSnake(key)
  },
  fieldDoc(doc) {
    // TODO
    return ""
  },
  modelDoc(doc) {
    // TODO
    return ""
  },
  oneOfKey(key) {
    return kotlinTarget.cls(key)
  },
  optional(type) {
    return `${type}?`
  },
  operationId(route) {
    if (route.operationId) {
      return kotlinTarget.variable(route.operationId)
    }

    return kotlinTarget.variable(route.summary)
  },
  httpMethod(m) {
    return m.toUpperCase()
  },
  operationParams(route, anonymousRequestBodyName) {
    let x: string[] = []

    if (route.parameters) {
      x = route.parameters.map((p) => {
        const param = p as ParameterObject
        switch (param.in) {
        case "path":
          // tslint:disable-next-line:max-line-length
          return `@Path("${param.name}") ${kotlinTarget.variable(param.name)}: ${resolveSchemaType(kotlinTarget, (<OpenApiGenSchema>param.schema), param.name)}${param.required ? "" : "? = null"}`
        case "query":
          // tslint:disable-next-line:max-line-length
          return `@Query("${param.name}") ${kotlinTarget.variable(param.name)}: ${resolveSchemaType(kotlinTarget, (<OpenApiGenSchema>param.schema), param.name)}${param.required ? "" : "? = null"}`
        default:
          // tslint:disable-next-line:max-line-length
          throw new Error(`Unhandled parameter type: ${param.in}, route: ${JSON.stringify(route.parameters)}`)
        }
      })
    }

    if (route.requestBody) {
      const requestBody = route.requestBody as RequestBodyObject
      
      if (requestBody.content) {
        const content = requestBody.content
        const k = Object.keys(content)[0]
        // tslint:disable-next-line:max-line-length
        x.push(`@Body body: ${resolveSchemaType(kotlinTarget, (<OpenApiGenSchema>content[k].schema), anonymousRequestBodyName)}`)
      }
    }

    return `(${x.join(",\n        ")})`
  },
  isHashable(v) {
    return true
  },
  generate({ config, security, name, groups, models, servers }) {
    return {
      "Generated.kt": apiTmpl({
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
      url: kotlinTarget.url(x.url),
      description: kotlinTarget.cls(x.description || `default${i}`),
      variables: _.map(x.variables, (v, k) => {
        // tslint:disable-next-line:max-line-length
        return `val ${kotlinTarget.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(x.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: kotlinTarget.variable(k),
        }
      }),
    }))
  },
}

module.exports = kotlinTarget
