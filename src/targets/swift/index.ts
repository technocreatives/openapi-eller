import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers, resolveSchemaType } from "targets"
import { TargetObject, OpenApiGenSchema } from "types"
import { ParameterObject } from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

const reservedWords = fs.readFileSync(__dirname + "/reserved-words.txt", "utf8").trim().split("\n")

// Identifiers begin with an uppercase or lowercase letter A through Z, 
// an underscore (_), a noncombining alphanumeric Unicode character 
// in the Basic Multilingual Plane, or a character outside the Basic 
// Multilingual Plane that isn’t in a Private Use Area. 
// After the first character, digits and combining Unicode characters are also allowed.
// const validIdentifiers = /^[A-Za-z_][A-Za-z0-9_]*$/;

const swiftTarget: TargetObject = {
  types: typeResolvers("swift"),
  variable(uncheckedName) {
    let name = uncheckedName
    if (typeof name === "number") {
      name = uncheckedName.toString()
    }
    
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
  },
  cls(name) {
    const hasAt = name.startsWith("@")

    const newName = _.flow([_.camelCase, _.upperFirst])(name)
    if (reservedWords.indexOf(newName) > -1) {
      return (hasAt ? "_" + newName : newName + "_")
    }
    return hasAt ? "_" + newName : newName
  },
  enumKey(key) { return swiftTarget.variable(key) },
  oneOfKey(key) { return swiftTarget.variable(key) },
  optional(type) {
    return `${type}?`
  },
  isHashable(type) {
    if (type.startsWith("[")) {
      return false
    }
    return true
  },
  operationId(route) {
    if (route.operationId) {
      return swiftTarget.variable(route.operationId)
    }

    return swiftTarget.variable(route.summary)
  },
  httpMethod(m) {
    return m
  },
  operationParams(route, hasDefaults) {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map((p) => {
      const param = p as ParameterObject
      const schema = param.schema as OpenApiGenSchema
      // tslint:disable-next-line:max-line-length
      return `${swiftTarget.variable(param.name)}: ${resolveSchemaType(swiftTarget, schema, param.name)}${param.required ? "" : `?${hasDefaults ? " = nil" : ""}`}`
    })
    
    if (x.length === 0) {
      return ""
    }
    return `${x.join(", ")}`
  },
  operationParamsDefaults(route) {
    return swiftTarget.operationParams(route, "true")
  },
  operationArgs(route) {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map(p => swiftTarget.variable((<ParameterObject>p).name))
    if (x.length === 0) {
      return ""
    }
    return `(${x.join(", ")})`
  },
  operationKwargs(route) {
    if (!route.parameters) {
      return ""
    }
    const x = route.parameters.map(p => swiftTarget.variable((<ParameterObject>p).name))
    if (x.length === 0) {
      return ""
    }
    return `(${x.map(xx => `${xx}: ${xx}`).join(", ")})`
  },
  requestParams(route) {
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

      return `__params["${param.name}"] = ${swiftTarget.variable(param.name)}`
    }).filter(x => x != null)
    
    if (q.length > 0) {
      return `
${indent}var __params = [String: Any]()
${indent}${q.join("\n" + indent)}
${indent}return .requestParameters(parameters: __params, encoding: URLEncoding.default)
`.trim()
    }

    return "return .requestPlain"
  },
  fieldDoc(doc) {
    return `// ${doc}`
  },
  modelDoc(doc) {
    return `// ${doc}`
  },
  generate({ config, security, name, groups, models, servers }) {
    return {
      // TODO: check if this name is ok
      "api.swift": apiTmpl({
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
    return u.replace(/\{(.*?)\}/g, (m, p1) => `\\(${swiftTarget.variable(p1)})`)
  },
  pathUrl(u) {
    return swiftTarget.url(u)
  },
  servers(servers) {
    return servers.map((x, i) => ({
      url: swiftTarget.url(x.url),
      description: swiftTarget.variable(x.description || `standard${i === 0 ? "" : i}`),
      arguments: _.map(x.variables, (v, k) => {
        return `let ${swiftTarget.variable(k)}`
      }).join(",\n        "),
      parameters: _.map(x.variables, (v, k) => {
        return `${swiftTarget.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(x.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: swiftTarget.variable(k),
        }
      }),
      variables: "",
    }))
  },
}

export default swiftTarget
