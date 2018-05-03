import fs from "fs"
import _ from "lodash"
import hbs from "handlebars"

import { typeResolvers } from "targets"
import { TargetObject } from "types"
import { ParameterObject } from "openapi3-ts"

const apiTmpl = hbs.compile(fs.readFileSync(__dirname + "/api.hbs", "utf8"))

const jsTarget: TargetObject = {
  types: typeResolvers("ecmascript"),
  cls(name) {
    return _.upperFirst(_.camelCase(name))
  },
  enumKey(name) {
    return jsTarget.cls(name)
  },
  variable(name) {
    return _.camelCase(name)
  },
  optional(name) {
    return name
  },
  fieldDoc(doc) {
    return "// " + doc
  },
  modelDoc(doc) {
    return "// " + doc
  },
  interface(name) {
    return jsTarget.cls(name)
  },
  oneOfKey(name) {
    return jsTarget.cls(name)
  },
  isHashable() {
    return false
  },
  enum(name) {
    return jsTarget.cls(name)
  },
  operationId(route) {
    if (route.operationId) {
      return jsTarget.variable(route.operationId)
    }

    return jsTarget.variable(route.summary)
  },
  httpMethod(name) {
    return name.toUpperCase()
  },
  pathUrl(name) {
    return name
  },
  url(u) {
    if (!u.endsWith("/")) {
      return `${u}/`
    }
    return u
  },
  operationParams(route) {
    let x: string[] = []
    
    if (route.parameters) {
      const params = route.parameters as ParameterObject[]
      x = params.map((p) => {
        return `${_.camelCase(p.name)}`
      })
    }

    if (route.requestBody) {
      x.push(`body`)
    }

    return `(${x.join(", ")})`
  },
  servers(servers) {
    return servers.map((server, i) => ({
      url: jsTarget.url(server.url),
      description: jsTarget.cls(server.description || `default${i}`),
      variables: _.map(server.variables, (v, k) => {
        return `val ${jsTarget.variable(k)}: String${v.default === "" ? "" : " = " + v.default}`
      }).join(",\n        "),
      replacements: _.map(server.variables, (v, k) => {
        return {
          key: `{${k}}`,
          value: jsTarget.variable(k)
        }
      })
    }))
  },
  generate({ config, security, name, groups, models, servers }) {
    // TODO: check if name is ok
    return {
      "api.js": apiTmpl({
        config,
        security,
        name,
        groups,
        models,
        servers
      })
    }
  }
}

export default jsTarget
