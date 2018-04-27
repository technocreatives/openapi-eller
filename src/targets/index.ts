import yaml from "js-yaml"
import fs from "fs"
import { Target, TargetTypeMap, TargetFormatMap, OpenApiGenSchema } from "types"

function typeResolvers(target: string, additionalResolvers?: TargetTypeMap): TargetTypeMap {
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

function resolveSchemaType(target: Target, schema: OpenApiGenSchema, name: string) {
  if (schema == null) {
    return resolveTypeImpl(target, null, null, null, false, false)
  }

  return resolveTypeImpl(target, schema, name, schema, false, false)
}

function resolveType(
  target: Target, 
  schema: OpenApiGenSchema, 
  name: string, 
  prop: OpenApiGenSchema
) {
  const isOptional = schema.required 
    ? schema.required.indexOf(name) < 0
    : true
  const isConstant = prop.enum ? prop.enum.length === 1 : false

  return resolveTypeImpl(target, schema, name, prop, isConstant, isOptional)
}

function resolveTypeImpl(
  target: Target, 
  schema: OpenApiGenSchema | null, 
  name: string | null, 
  prop: OpenApiGenSchema | null, 
  isConstant: boolean, 
  isOptional: boolean
): string {
  
  const { types, optional } = target

  let type: string | undefined
  let format: string | undefined

  if (prop) {
    type = prop.type
    format = prop.format
  }
  
  const renames = target.config && target.config.renames || {}
  const userTypes = target.config && target.config.types || {}
  
  let candidate
  
  if (type === "object" && prop != null && prop.additionalProperties) {
    const value = resolveTypeImpl(
      target, 
      schema, 
      null, 
      prop.additionalProperties as OpenApiGenSchema, 
      false, 
      false
    )
    candidate = types.map
      .replace("{key}", types["string"][format || "null"] || types["string"]["null"])
      .replace("{value}", value)
  } else if (prop && prop.key) {
    if (prop.title) {
      candidate = target.cls(prop.title)
    } else {
      candidate = target.cls(prop.key)
    }
  } else if (prop && prop.enum) {
    const propTitle = prop.title

    // TODO: check if these names are ok if enum method is missing
    if (propTitle) {
      candidate = target.enum ? target.enum(propTitle) : propTitle
    } else if (name) {
      candidate = target.enum ? target.enum(name) : name
    } else {
      throw new Error("Unhandled enum naming for " + JSON.stringify(prop))
    }
    
  } else if (prop && prop.oneOf && name) {
    // Treat this as a very special enum :)
    candidate = target.interface(name) || target.cls(name)
  } else if (type === "array") {
    const items = (prop != null ? prop.items : null) as OpenApiGenSchema

    // TODO: add support for Set<V>
    candidate = types.array.replace(
      "{value}", 
      resolveTypeImpl(target, schema, name, items, false, false)
    )
  } else if (name !== null && (type === "object" || type == null)) {
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
        throw new Error(`Could not handle input: ${type} ${format} for ${JSON.stringify(prop)}, ${JSON.stringify(schema)}`)
      }

      candidate = candidateUserType[format || "null"] || 
        candidateType[format || "null"] || 
        candidateType["null"]
    } catch (e) {
      console.error(e.stack)
      // tslint:disable-next-line:max-line-length
      throw new Error(`Could not handle input: ${type} ${format} for ${JSON.stringify(prop)}, ${JSON.stringify(schema)}`)
    }
  }

  if (!candidate) {
    const key = schema != null ? schema.key : null
    throw new Error(`Got null for schema ${key} for prop ${JSON.stringify(prop)}`)
  }

  if (renames[candidate]) {
    candidate = renames[candidate]
  }

  if (isOptional && optional) {
    candidate = optional(candidate)
  }

  return candidate
}

export {
  resolveSchemaType,
  resolveType,
  typeResolvers,
}
