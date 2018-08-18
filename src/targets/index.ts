import yaml from "js-yaml"
import fs from "fs"
import {
  Target,
  TargetTypeMap,
  TargetFormatMap
} from "types"
import hbs, { TemplateDelegate, HelperOptions } from "handlebars"
import path from "path"

import EcmaScriptTarget from "./ecmascript"
import AspNetTarget from "./csharp-aspnet"
import SwiftTarget from "./swift"
import RustTarget from "./rust"
import KotlinTarget from "./kotlin"
import { SchemaContext } from "visitor";
import { SchemaObject } from "openapi3-ts";
import TypeScriptTarget from "./typescript";

// Re-export the targets
export {
  KotlinTarget,
  SwiftTarget,
  AspNetTarget,
  RustTarget,
  EcmaScriptTarget
}

export const knownTargets = [
  "csharp-aspnet", "ecmascript", "kotlin", "rust", "swift", "typescript"
]

export function resolveTarget(targetName: string): typeof Target | null {
  switch (targetName.toLowerCase()) {
    case "kotlin":
      return KotlinTarget
    case "swift":
      return SwiftTarget
    case "rust":
      return RustTarget
    case "aspnet":
    case "csharp-aspnet":
      return AspNetTarget
    case "ecmascript":
    case "javascript":
    case "js":
    case "es":
      return EcmaScriptTarget
    case "ts":
    case "typescript":
      return TypeScriptTarget
    default:
      return null
  }
}

export function handlebarsInstance(tmplPath: string, partialsDir: string): TemplateDelegate {
  const instance = hbs.create()

  instance.registerHelper("indent", function indent(this: any, options: HelperOptions) {
    const hash = options.hash || { size: 4 }
    const padding = Array((hash.size || 4) + 1).join(" ")
    const content = options.fn(this)
    return content.split("\n").map(s => `${padding}${s}`.trimRight()).join("\n")
  })

  for (const partialFilename of fs.readdirSync(partialsDir)) {
    if (!partialFilename.endsWith(".hbs")) {
      continue
    }

    const partialBody = fs.readFileSync(path.join(partialsDir, partialFilename), "utf8")
    instance.registerPartial(partialFilename.split(".").slice(0, -1).join("."), instance.compile(partialBody))
  }
  
  return instance.compile(fs.readFileSync(tmplPath, "utf8"))
}

export function typeResolvers(target: string, additionalResolvers?: TargetTypeMap): TargetTypeMap {
  const targetTypeMapFilePath = fs.readFileSync(`${__dirname}/${target}/types.yaml`, "utf8")
  const types = yaml.safeLoad(targetTypeMapFilePath) as TargetTypeMap
  
  if (additionalResolvers) {
    Object.keys(additionalResolvers).reduce((additionalTypes, typeKey) => {
      additionalTypes[typeKey] = Object.keys(additionalResolvers[typeKey])
        .reduce((acc: TargetFormatMap, k) => {
          acc[k] = (<TargetFormatMap>additionalResolvers[typeKey])[k]

          return acc
        }, additionalTypes[typeKey] as TargetFormatMap || {} as TargetFormatMap)

      return additionalTypes
    }, types)
  }

  return types
}

export function resolveSchemaType(target: Target, context: SchemaContext | null, schema: SchemaObject | null, name: string | null) {
  if (schema == null) {
    return resolveTypeImpl(target, null, null, null, null, null, false)
  }

  return resolveTypeImpl(target, context, schema, name, name, schema, false)
}

export function resolveType(
  target: Target,
  context: SchemaContext | null,
  schema: SchemaObject,
  key: string,
  name: string, 
  prop: SchemaObject
) {
  const isOptional = schema.required 
    ? schema.required.indexOf(key) < 0
    : true
  // console.log(name, schema.required, isOptional)
  // const isConstant = prop.enum ? prop.enum.length === 1 : false

  return resolveTypeImpl(target, context, schema, key, name, prop, isOptional)
}

function resolveTypeImpl(
  target: Target,
  context: SchemaContext | null,
  schema: SchemaObject | null, 
  key: string | null, 
  name: string | null, 
  propertySchema: SchemaObject | null,
  isOptional: boolean
): string {
  const { visitor, config } = target
  const { types, optional } = target

  let type: string | undefined
  let format: string | undefined

  if (propertySchema) {
    type = propertySchema.type
    format = propertySchema.format
  }
  
  const renames = config && config.renames || {}
  const userTypes = config && config.types || {}
  
  let candidate
  
  // Format is required here, otherwise additionalProperties loops badly.
  if (type === "object" && propertySchema != null && propertySchema.additionalProperties) {
    const additionalPropsSchema = propertySchema.additionalProperties
    const childCtx = visitor.schemas.get(additionalPropsSchema) || null
    const value = resolveTypeImpl(
      target,
      childCtx,
      schema, 
      null,
      childCtx != null && !childCtx.isTransient ? childCtx.name(target.visitor) : null,
      additionalPropsSchema,
      false
    )
    
    candidate = types.map
      .replace("{key}", types["string"][format || "null"] || types["string"]["null"])
      .replace("{value}", value)
  } else if (propertySchema && propertySchema.key) {
    if (propertySchema.title && propertySchema.hasModelTitle) {
      candidate = target.cls(propertySchema.title)
    } else {
      candidate = target.cls(propertySchema.key)
    }
  } else if (propertySchema && propertySchema.enum) {
    const propTitle = propertySchema.title

    if (propTitle) {
      candidate = target.enum(propTitle)
    } else if (name) {
      candidate = target.enum(name)
    } else {
      // TODO: add propertySchema's context as well
      throw new Error("Unhandled enum naming for " + JSON.stringify(propertySchema))
    }
    
  } else if (propertySchema && propertySchema.oneOf && name) {
    // Treat this as a very special enum :)
    candidate = target.interface(name) || target.cls(name)
  } else if (propertySchema && propertySchema.allOf && name) {
    candidate = target.cls(name)
  } else if (type === "array" && propertySchema != null) {
    const items = propertySchema.items as SchemaObject

    const propertySchemaCtx = visitor.schemas.get(propertySchema)
    const itemsName = propertySchemaCtx != null && !propertySchemaCtx.isTransient 
      ? propertySchemaCtx.name(visitor)
      : name

    // TODO: add support for Set<V>
    candidate = types.array.replace(
      "{value}", 
      resolveTypeImpl(target, context, schema, itemsName, itemsName, items, false)
    )
  } else if (name !== null && ((type === "object" && format == null) || type == null)) {
    candidate = target.cls(name)
  } else if (type == null) {
    return types["null"]
  } else {
    // Some kind of semi-primitive or "well known" type
    try {
      const candidateUserType = userTypes[type] as TargetFormatMap || {}
      const candidateType = types[type] as TargetFormatMap || {}

      if (!candidateType && !candidateUserType) {
        // tslint:disable-next-line:max-line-length
        throw new Error(`Could not handle input: ${type} ${format} for ${JSON.stringify(propertySchema)}, ${JSON.stringify(schema)}`)
      }

      candidate = candidateUserType[format || "null"] || 
        candidateType[format || "null"] || 
        candidateType["null"]
    } catch (e) {
      console.error(e.stack)
      // tslint:disable-next-line:max-line-length
      throw new Error(`Could not handle input: ${type} ${format} for ${JSON.stringify(propertySchema)}, ${JSON.stringify(schema)}`)
    }
  }

  if (candidate == null) {
    const key = schema != null ? schema.key : null
    throw new Error(`Got null for schema ${key} for prop ${JSON.stringify(propertySchema)}`)
  }

  if (renames[candidate]) {
    candidate = renames[candidate]
  }

  if (isOptional && optional) {
    candidate = optional(candidate)
  }

  return candidate
}
