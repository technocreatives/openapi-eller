import jref from "json-ref-lite"
import { 
  OpenApiGenObject,
  Target,
  TargetModel,
  OpenApiGenSchema,
  TargetField,
  EnumObject,
  EnumObjectType,
  TargetFieldMap
} from "types"
import { resolveType } from "./targets"
import _ from "lodash"
import logger from "winston"

class ModelGenerator {
  private target: Target

  constructor(target: Target) {
    this.target = target
  }

  private processEnum(schema: OpenApiGenSchema) {
   return {
      name: this.target.cls(schema.key),
      type: "enum",
      isEnum: true,
      values: (schema.enum as string[]).map((x: string) => ({
        key: this.target.enumKey(x),
        value: x
      })),
      interfaces: [],
      fields: {},
      enums: {},
      doc: ""
    }
  }

  private modelRename(key: string): string | undefined {
    const { renames } = this.target.config

    if (renames) {
      return renames[name]
    }
  }

  private fieldRename(schema: OpenApiGenSchema, key: string): string | undefined {
    const { fieldRenames } = this.target.config

    if (fieldRenames && fieldRenames[schema.key]) {
      return fieldRenames[schema.key][key]
    }
  }

  private processField(
    prop: OpenApiGenSchema,
    schema: OpenApiGenSchema,
    key: string
  ): TargetField {
    const baseName = prop.title || key
    const type = resolveType(this.target, schema, key, prop)
    const name = this.fieldRename(schema, key) || this.target.variable(baseName)

    return {
      name,
      type,
      key,
      doc: this.target.fieldDoc(prop),
      isHashable: this.target.isHashable(type),
      isEnum: prop.enum != null,
      isOneOf: prop.oneOf != null,
      isOptional: schema.required ? schema.required.indexOf(key) < 0 : true,
      format: this.target.format(prop),
      isNameEqualToKey: name === key
    }
  }

  private processFields(properties: { [key: string]: OpenApiGenSchema }, schema: OpenApiGenSchema): TargetFieldMap {
    return Object.keys(properties).reduce((
      fieldObject: TargetFieldMap,
      key: string
    ) => {
      const prop = properties[key] as OpenApiGenSchema
      fieldObject[key] = this.processField(prop, schema, key)
      return fieldObject
    }, {})
  }

  private processOneOfField(prop: OpenApiGenSchema, key: string, schema: OpenApiGenSchema): {
    enumObj: EnumObject,
    interfaces: { [key: string]: string[] }
  } {
    const baseName = prop.title || key
    const name = this.target.interface(baseName)
    const oneOf = prop.oneOf as OpenApiGenSchema[]
    // There's a bug with the OpenAPI specification that doesn't allow string discriminators
    const discriminator = prop.discriminator as any as string
    const oneOfProperties = oneOf[0].properties
    
    if (!(oneOfProperties && discriminator)) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`Object with oneOf definition is lacking a discriminator: ${schema.key}`)
    }

    const firstOne = oneOfProperties[discriminator] as OpenApiGenSchema
    const interfaces: { [key: string]: string[] } = {}

    const values = oneOf.map((o) => {
      const v = {
        key: this.target.oneOfKey(o.key),
        type: resolveType(this.target, schema, key, o),
        value: o.key
      }

      // Mark interfaces on targets
      if (interfaces[v.type] == null) {
        interfaces[v.type] = []
      }

      // TODO: nestedInterface func
      interfaces[v.type].push(`${this.target.cls(schema.key)}.${name}`)

      return v
    })
    
    const enumObj: EnumObject = {
      name,
      discriminator,
      values,
      type: EnumObjectType.OneOf,
      isOneOf: true,
      isEnum: false,
      discriminatorType: firstOne.key,
      discriminatorVariable: this.target.variable(discriminator)
    }

    return {
      enumObj,
      interfaces
    }
  }

  private processEnumField(prop: OpenApiGenSchema, key: string, schema: OpenApiGenSchema): EnumObject {
    const baseName = prop.title || key
    const name = this.target.enum(baseName)
    const enumDef = prop.enum as string[]

    return {
      name,
      type: EnumObjectType.Enum,
      isEnum: true,
      isOneOf: false,
      values: enumDef.map(x => ({
        key: this.target.enumKey(x),
        value: x
      }))
    }
  }

  private processModelObject(schema: OpenApiGenSchema, schemaKey: string): {
    model: TargetModel | undefined,
    interfaces: { [key: string]: string[] } | undefined
  } {
    if (schema.properties == null) {
      return { model: undefined, interfaces: undefined }
      // TODO: handle this
      // throw new Error(`No properties found for schema '${schema.key}'`)
    }

    const properties = schema.properties as { [key: string]: OpenApiGenSchema }
    const fields = this.processFields(properties, schema)
    const modelInterfaces: { [key: string]: string[] } = {}

    // Generate nested enums
    const enums: { [key: string]: EnumObject } = Object.keys(properties)
      .filter(k => (properties[k].enum && !properties[k].key) || properties[k].oneOf)
      .reduce((acc: { [key: string]: EnumObject }, key: string) => {
        const prop = properties[key] as OpenApiGenSchema
        
        if (prop.oneOf && prop.oneOf.length > 0) {
          const { enumObj, interfaces } = this.processOneOfField(prop, key, schema)
          
          // Merge given interfaces into output interface object
          Object.assign(modelInterfaces, interfaces)

          acc[enumObj.name] = enumObj
        } else if (prop.enum) {
          const enumObj = this.processEnumField(prop, key, schema)

          acc[enumObj.name] = enumObj
        }

        return acc
      }, {})

    // TODO: nested objects
    Object.keys(properties)
      .filter(k => properties[k].type === "object" && properties[k].key == null)
      .forEach((k) => {
        console.error(`${schema.key}:${k}: unhandled nested object`)
      })

    // Strange enum handling that could do with a refactor
    Object.keys(properties)
      .filter((k) => {
        const obj = properties[k]

        if (obj.type !== "array" || obj.items == null) {
          return false
        }

        const itemsEnum = (obj.items as OpenApiGenSchema).enum
        if (!itemsEnum) {
          return false
        }

        // An enum array can have a key put on it, as it behaves as a model in some cases.
        const enumHasNoKey = (itemsEnum as any).key == null

        // console.error(enumHasNoKey, obj)

        return enumHasNoKey
      })
      .reduce((o, key) => {
        let baseName = key
        const schema = properties[key]
        const items = schema.items as OpenApiGenSchema
        if (items && items.title) {
          baseName = items.title as string
        }
        
        const name = this.target.enum(baseName)

        if (!items.enum) {
          return o
        }

        o[name] = {
          name,
          type: EnumObjectType.Enum,
          isEnum: true,
          isOneOf: false,
          values: items.enum.map(x => ({
            key: this.target.enumKey(x),
            value: x
          }))
        }
        return o
      }, enums)

    const baseName = this.target.cls(schemaKey)
    const name = this.modelRename(baseName) || baseName

    const doc = this.target.modelDoc(schema)
    // TODO: check what the type field is, currently blank string
    // Same with values, interfaces...
    const model = {
      name, 
      fields, 
      enums, 
      doc,
      type: "",
      isEnum: false,
      values: [],
      interfaces: []
    }

    return {
      model,
      interfaces: modelInterfaces
    }
  }

  generate(tree: OpenApiGenObject): { [key: string]: TargetModel } {
    if (tree.components == null || tree.components.schemas == null) {
      return {}
    }

    const { schemas } = tree.components
    const models: { [key: string]: TargetModel } = {}
    const modelInterfaces: { [key: string]: string[] } = {}

    _.forEach(schemas, (schema: OpenApiGenSchema, schemaKey: string) => {
      if (schema.enum) {
        models[schema.key] = this.processEnum(schema)
        return
      }

      if (schema.type === "array") {
        // tslint:disable-next-line:max-line-length
        const msg = schema.key + ": Array models cannot be represented in most programming languages. " +
          "Prefer an object and use the `items` property to generate a representable version of this model."
        logger.warn(msg)
        return
      }

      if (schema.type === "object") {
        const { model, interfaces } = this.processModelObject(schema, schemaKey)
        if (model != null && interfaces != null) {
          models[schema.key] = model
          Object.assign(modelInterfaces, interfaces)
        }
        return
      }

      logger.warn(`Found unhandleable entity '${schemaKey}': ${JSON.stringify(schema)}`)
    })

    // Assign all interfaces to the relevant models
    _.forEach(modelInterfaces, (interfaces, k) => {
      models[k].interfaces = interfaces
    })

    return jref.resolve(models) as { [key: string]: TargetModel }
  }
}

export function generateModels(
  tree: OpenApiGenObject, 
  target: Target
): { [key: string]: TargetModel } {
  return new ModelGenerator(target).generate(tree)
}
