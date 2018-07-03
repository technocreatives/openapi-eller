import {
  OpenAPIObject, InfoObject, PathObject, OperationObject, ParameterObject, PathItemObject, ReferenceObject, SchemaObject, RequestBodyObject, ExampleObject, ComponentsObject, ServerObject, ResponsesObject, ResponseObject
} from "openapi3-ts"

import jref from "json-ref-lite"
import * as yaml from "js-yaml"
import * as fs from "fs"
import { 
  OpenApiGenTree,
  Target,
  TargetModel,
  OpenApiGenSchema,
  TargetField,
  EnumObject,
  EnumObjectType,
  TargetFieldMap
} from "types"
import logger from "winston"
import { resolveType } from "./targets"
import _ from "lodash"

const httpVerbs = [
  "get", "put", "post", "delete", "options", "head", "patch", "trace"
]

function pathAsString(path: (string | number)[]) {
    let o = ""
    for (let i = 0; i < path.length; ++i) {
        const v = path[i]

        if (typeof path[i] === "number") {
            o += `[${v}]`
        } else if (i === 0) {
            o += v
        } else if (/^<.*>$/.test(v as string)) {
            o += `.${(v as string).slice(1, -1)}`
        } else if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(v as string)) {
            o += `["${v}"]`
        } else {
            o += `.${v}`
        }
    }
    return o
}

class Response {

}

export type Combiner = "anyOf" | "oneOf" | "allOf"

export abstract class Visitor {
    private walkedPath: (string | number)[] = []
    private walkedSet = new WeakSet()

    private walk(...points: (string | number)[]) {
        for (const p of points) {
            this.walkedPath.push(p)
        }

        // console.log("-> " + this.pathToString())
    }

    private unwalk(count: number = 1) {
        for (let i = 0; i < count; ++i) {
            this.walkedPath.pop()
        }
        
        // console.log("<- " + this.pathToString())
    }

    protected position(reverseIndex: number = 0): string | number {
        return this.walkedPath[this.walkedPath.length - reverseIndex - 1]
    }

    protected path(): (string | number)[] {
        return this.walkedPath.slice()
    }

    protected pathAsString(): string {
        return pathAsString(this.walkedPath)
    }

    protected error(message: string): Error {
        return new Error(`${this.pathAsString()}: ${message}`)
    }

    private assertNotRef<T>(candidate: ReferenceObject | T): T {
        if ((candidate as ReferenceObject).$ref) {
            throw this.error("$ref found; must be resolved prior to being visited")
        }

        return candidate as T
    }

    abstract visitInfo(info: InfoObject): void
    abstract visitParameter(pathKey: string, httpVerb: string | null, parameter: ParameterObject): void
    abstract visitSchema(schema: SchemaObject, parentSchema: SchemaObject | null, combiner: Combiner | null): void
    abstract visitOperation(operationId: string, summary: string | undefined, description: string | undefined, tags: string[] | undefined, responses: ResponsesObject): void
    abstract visitOperationRequestBody(operationId: string, mediaType: string, schema: SchemaObject): any
    abstract visitRequestBodyExample(example: ExampleObject): void
    abstract visitResponseExample(example: ExampleObject): void
    abstract visitServer(server: ServerObject): void
    
    walkSchema(schema: SchemaObject, parentSchema: SchemaObject | undefined, combiner: Combiner | undefined) {
      const { anyOf, oneOf, allOf, properties, items } = schema

      if (schema.type === "array") {
        console.error(schema)
      }

      const iterWalk = (c: Combiner, iter: SchemaObject[]) => {
        this.visitSchema(schema, parentSchema || null, c)
        this.walk(c)
        let i = 0
        for (const s of iter) {
          this.walk(i)
          this.walkSchema(s, schema, c)
          i++
          this.unwalk()
        }
        this.unwalk()
      }

      if (allOf != null) {
        iterWalk("allOf", allOf)
      } else if (oneOf != null) {
        iterWalk("oneOf", oneOf)
      } else if (anyOf != null) {
        iterWalk("anyOf", anyOf)
      } else {
        this.visitSchema(schema, parentSchema || null, combiner || null)
      }

      if (this.walkedSet.has(schema)) {
        return
      }
      
      if (properties != null) {
        this.walk("properties")
        for (const propertyKey in properties) {
          this.walk(propertyKey)
          this.walkSchema(this.assertNotRef(properties[propertyKey]), schema, undefined)
          this.unwalk()
        }
        this.unwalk()
      }

      if (items != null) {
        this.walk("items")
        this.walkSchema(this.assertNotRef(items), schema, undefined)
        this.unwalk()
      }

      this.walkedSet.add(schema)
    }

    walkResponse(response: ResponseObject) {
      console.log(response)
      const { content } = response

      if (content != null) {
        for (const mediaTypeKey in content) {
          this.walk(mediaTypeKey)
          const { schema, example } = content[mediaTypeKey]

          if (schema != null) {
            this.walk("schema")
            this.walkSchema(this.assertNotRef(schema), undefined, undefined)
            this.unwalk()
          }

          if (example != null) {
            this.walk("example")
            this.visitResponseExample(this.assertNotRef(example))
            this.unwalk()
          }

          this.unwalk()
        }
      }
    }

    walkRequestBody(requestBody: RequestBodyObject, operationId?: string) {
      const { content } = requestBody

      for (const mediaTypeKey in content) {
        this.walk(mediaTypeKey)
        const mediaTypeValue = content[mediaTypeKey]

        // TODO: encoding
        const { example, schema } = mediaTypeValue

        if (schema != null) {
          this.walk("schema")
          this.walkSchema(this.assertNotRef(schema), undefined, undefined)
          // Handle the field in Operations
          if (operationId != null) {
            this.visitOperationRequestBody(operationId, mediaTypeKey, schema)
          }
          this.unwalk()
        }

        if (example != null) {
          this.walk("example")
          this.visitRequestBodyExample(this.assertNotRef(example))
          this.unwalk()
        }


        this.unwalk()
      }
    }
    
    walkOperation(pathKey: string, httpVerb: string, operation: OperationObject): void {
        const { operationId, schema, parameters, requestBody, responses, summary, description, tags } = operation

        if (operationId == null) {
            throw this.error("`operationId` field must be present.")
        }

        this.visitOperation(operationId, summary, description, tags, operation.responses)

        if (parameters != null) {
            this.walk("parameters")
            this.walkParameters(pathKey, httpVerb, parameters)
            this.unwalk()
        }
        
        if (requestBody != null) {
            this.walk("requestBody")
            this.walkRequestBody(this.assertNotRef(requestBody), operationId)
            this.unwalk()
        }

        if (responses != null && this.assertNotRef(responses)) {
          this.walk("responses")
          for (const mediaTypeKey in responses) {
            this.walk(mediaTypeKey)
            const response = responses[mediaTypeKey] as ResponseObject
            this.walkResponse(response)
            this.unwalk()
          }
          this.unwalk()
        }

        if (schema != null) {
            this.walk("schema")
            this.walkSchema(schema, undefined, undefined)
            this.unwalk()
        }
    }

    walkParameters(pathKey: string, httpVerb: string | null, parameters: (ReferenceObject | ParameterObject)[]) {
        let i = 0
        for (const parameter of parameters) {
            this.walk(i)
            this.visitParameter(pathKey, httpVerb, this.assertNotRef(parameter))

            const { schema } = (parameter as ParameterObject)
            if (schema != null) {
                this.walk("schema")
                this.walkSchema(this.assertNotRef(schema), undefined, undefined)
                this.unwalk()
            }

            i += 1
            this.unwalk()
        }
    }

    walkPaths(paths: PathObject) {
        this.walk("paths")
        for (const pathKey in paths) {
            this.walk(pathKey)
            const pathValue = paths[pathKey] as PathItemObject

            const { parameters } = pathValue
            if (parameters != null) {
                this.walk("parameters")
                this.walkParameters(pathKey, null, parameters)
                this.unwalk()
            }

            for (const verb of httpVerbs) {
                this.walk(verb)
                const operationValue = pathValue[verb]
                if (operationValue != null) {
                    this.walkOperation(pathKey, verb, operationValue)
                }
                this.unwalk()
            }
            this.unwalk()
        }
        this.unwalk()
    }

    walkComponents(components: ComponentsObject) {
        this.walk("components")

        const iterWalk = <T>(walkKey: string, callback: (t: T) => void, iterable: { [key: string]: T } | undefined) => {
            if (iterable != null) {
                this.walk(walkKey)
                for (const key in iterable) {
                    this.walk(key)
                    callback(this.assertNotRef(iterable[key]))
                    this.unwalk()
                }
                this.unwalk()
            }
        }
        // callbacks, securitySchemes
        const { schemas, requestBodies, responses } = components
        
        iterWalk("schema", this.walkSchema.bind(this), schemas)
        iterWalk("requestBodies", this.walkRequestBody.bind(this), requestBodies)
        iterWalk("responses", this.walkResponse.bind(this), responses)

        this.unwalk()
    }

    walkServers(servers: ServerObject[]) {
        this.walk("servers")
        for (let i = 0; i < servers.length; ++i) {
            this.walk(i)
            this.visitServer(servers[i])
            this.unwalk()
        }
        this.unwalk()
    }

    private tree: OpenAPIObject

    constructor(input: any) {
        const tree = jref.resolve(input) as OpenAPIObject

        const { openapi, info, paths } = tree

        if (openapi == null || !openapi.startsWith("3.")) {
            throw new Error("`openapi` field invalid; must start with 3.")
        }

        if (info == null) {
            throw new Error("`info` field must be present.")
        }

        if (paths == null) {
            throw new Error("`paths` field must be present.")
        }

        this.tree = tree
    }

    start() {
        this.walkedPath = []
        this.walkedSet = new WeakSet()

        const { info, paths, components, servers } = this.tree
        this.walk("info")
        this.visitInfo(info)
        this.unwalk()

        if (servers != null) {
            this.walkServers(servers)
        }

        if (components != null) {
            this.walkComponents(components)
        }
        
        this.walkPaths(paths)
    }
}

interface Parameter {
    name: string
    in: string
    required: boolean
}

export interface Operation {
    httpVerb: string
    operationId: string,
    urlPath: string,
    parameters: ParameterObject[],
    responses: ResponsesObject,
    requestMediaType?: string | undefined,
    requestBody?: SchemaObject | undefined,
    summary?: string | undefined
    description?: string | undefined
    tags?: string[] | undefined,
}

function isComponentSchema(path: (string | number)[]): boolean {
    return path.length === 3 && path[0] === "components" && path[1] === "schema"
}

export function isComplexType(schema: SchemaObject): boolean {
    const { type } = schema
    
    if (schema.allOf || schema.anyOf || schema.oneOf) {
        return true
    }

    return type === "object" || type === "array" || schema.enum != null
}

export class SchemaContext {
  schema: SchemaObject
  path: (string | number)[]
  children: Map<SchemaObject, SchemaContext>
  combiner: Combiner | null
  isTransient: boolean

  name(visitor: GeneratorVisitor): string {
    const thingo = () => {
      if (this.schema.type === "array") {
        const items = this.schema.items as SchemaObject
        if (items != null && !isComplexType(items) && items.type != null) {
          return items.type 
        }
        const child = this.children.values().next()
        if (child == null || child.value == null) {
          throw new Error(`${pathAsString(this.path)}: missing child in array schema`)
        }
        return child.value.name(visitor)
      }

      if (isComponentSchema(this.path)) {
        return this.path[2] as string
      }

      const firstPath = this.path.slice()
      let len = firstPath.length

      if (firstPath[len - 1] === "schema") {
        len--
      }

      if (firstPath[len - 2] === "parameters") {
        let key
        if (firstPath[len - 4] === "paths") {
          key = firstPath[len - 3]
        } else {
          const pathKey = firstPath[len - 4]
          const httpVerb = firstPath[len - 3]
          key = `${pathKey}.${httpVerb}`
        }
        const index = firstPath[len - 1] as number

        const operation = visitor.pathMap[key]

        if (operation == null) {
          return visitor.paramMap[key][index].name
        }

        return `${operation.operationId}.${visitor.paramMap[key][index].name}`
      }

      if (len === 4 && firstPath[0] === "components" && firstPath[1] === "requestBodies") {
        return firstPath[2].toString()
      }

      if (len === 4 && firstPath[0] === "components" && firstPath[1] === "responses") {
        return firstPath[2].toString()
      }

      if (typeof firstPath[len - 1] === "number") {
        return `${firstPath[len - 2]}$${firstPath[len - 1]}`
      }

      if (len === 6 && firstPath[0] === "paths") {
        const { operationId } = visitor.pathMap[`${firstPath[1]}.${firstPath[2]}`]
        return `${operationId}Response`
      }

      return firstPath[len - 1] as string
    }

    const ret = thingo()
    if (ret === "application/json") {
      throw new Error(pathAsString(this.path))
    }
    return ret
  }

  constructor(schema: SchemaObject, path: (string | number)[], combiner: Combiner | null = null, isTransient: boolean = false) {
    this.schema = schema
    this.path = path
    this.children = new Map()
    this.combiner = combiner
    this.isTransient = isTransient
  }

  toString(visitor: GeneratorVisitor, indent = 0): string {
    const padding = Array(indent + 1).join(" ")
    let o = `${padding}${this.name(visitor)}`
    if (this.isTransient) {
      o += " (transient)"
    }
    if (this.combiner) {
      o += ` (${this.combiner})`
    }
    o += ` <${pathAsString(this.path)}>`
    this.children.forEach((ctx, child) => {
      o += "\n"
      o += ctx.toString(visitor, indent + 2)
    })
    return o
  }
}

export class GeneratorVisitor extends Visitor {
    private name: string | undefined
    private description: string | undefined
    pathMap: { [pathKey: string]: Operation } = {}
    operations: { [operationId: string]: Operation } = {}
    private servers: ServerObject[] = []
    schemas: Map<SchemaObject, SchemaContext> = new Map()

    paramMap: { [pathKey: string]: ParameterObject[] } = {}

    visitInfo(info: InfoObject): void {
        this.name = info.title
        this.description = info.description
    }

    visitParameter(pathKey: string, httpVerb: string | null, parameter: ParameterObject): void {
        const key = httpVerb ? `${pathKey}.${httpVerb}` : pathKey
        console.log("PARAM", key, parameter)
        const params = this.paramMap[key]
        if (params == null) {
          this.paramMap[key] = [parameter]
        } else {
          params.push(parameter)
        }
    }

    visitSchema(schema: SchemaObject, parentSchema: SchemaObject | null, combiner: Combiner | null): void {
        // console.log(this.pathAsString() + ": schema")
        // console.log(this.pathAsString(), parentSchema != null, combiner)
        if (!isComplexType(schema)) {
            // console.log(this.pathAsString() + ": not complex")
            return
        }

        if (parentSchema != null) {
            let parentCtx = this.schemas.get(parentSchema)

            if (parentCtx == null) {
                console.error(parentSchema)
                throw this.error("This should not be possible")
            }

            const childCtx = this.schemas.get(schema)

            if (childCtx == null) {
                const newCtx = new SchemaContext(schema, this.path(), null, true)
                parentCtx.children.set(schema, newCtx)
                this.schemas.set(schema, newCtx)
            } else {
                parentCtx.children.set(schema, childCtx)
            }
        } else {
            const ctx = this.schemas.get(schema) as SchemaContext

            if (ctx == null || ctx.isTransient) {
                this.schemas.set(schema, new SchemaContext(schema, this.path(), combiner))
            }
        }
    }

    visitOperationRequestBody(
      operationId: string,
      mediaType: string,
      schema: SchemaObject
    ): void {
      const operation = this.operations[operationId]
      if (operation != null) {
        operation.requestBody = schema
        operation.requestMediaType = mediaType
      }
    }

    visitOperation(
      operationId: string,
      summary: string | undefined,
      description: string | undefined,
      tags: string[] | undefined,
      responses: ResponsesObject
    ): void {
      const httpVerb = this.position() as string
      const pathKey = this.position(1) as string
      const key = `${pathKey}.${httpVerb}`
      console.log("LOL", key)
      const self = this

      const o: Operation = {
        httpVerb,
        operationId,
        urlPath: pathKey,
        summary,
        description,
        tags, 
        get parameters(): ParameterObject[] {
          const baseParams = self.paramMap[pathKey] || []
          const verbParams = self.paramMap[key] || []
          return baseParams.concat(verbParams)
        },
        responses
      }

      this.pathMap[key] = o
      this.operations[operationId] = o
    }

    visitRequestBodyExample(example: ExampleObject): void {

    }

    visitResponseExample(example: ExampleObject): void {

    }

    visitServer(server: ServerObject): void {
        this.servers.push(server)
    }
}

interface ModelAndInterfaces {
  model?: TargetModel | undefined,
  interfaces?: { [key: string]: string[] } | undefined
}

export class ModelGenerator {
  private visitor: GeneratorVisitor
  private target: Target

  constructor(target: Target, visitor: GeneratorVisitor) {
    this.visitor = visitor
    this.target = target
  }

  private processEnum(ctx: SchemaContext, schema: SchemaObject): TargetModel {
    const enumValue = schema.enum

    if (enumValue == null) {
      throw new Error(`${pathAsString(ctx.path)}: processing enum without enum present`)
    }

    return {
      name: this.target.cls(ctx.name(this.visitor)),
      type: "enum",
      isEnum: true,
      values: enumValue.map((x: string) => {
        return {
          key: this.target.enumKey(x),
          value: x
        }
      }),
      interfaces: [],
      fields: {},
      enums: {},
      doc: schema.description
    }
  }

  private fieldRename(schema: SchemaObject, key: string): string | undefined {
    const { fieldRenames } = this.target.config

    if (fieldRenames && fieldRenames[schema.key]) {
      return fieldRenames[schema.key][key]
    }
  }

  private processField(
    ctx: SchemaContext,
    schema: SchemaObject,
    propertySchema: SchemaObject,
    key: string
  ): TargetField {
    const baseName = propertySchema.title || key
    const propertySchemaCtx = this.visitor.schemas.get(propertySchema)
    const pkey = propertySchemaCtx ? propertySchemaCtx.name(this.visitor) : key
    const type = resolveType(this.target, ctx, schema, pkey, propertySchema)
    const name = this.fieldRename(schema, key) || this.target.variable(baseName)

    return {
      name,
      type,
      key,
      doc: this.target.fieldDoc(propertySchema),
      isHashable: this.target.isHashable(type),
      isEnum: propertySchema.enum != null,
      isOneOf: propertySchema.oneOf != null,
      isOptional: schema.required ? !schema.required.includes(key) : true,
      format: this.target.format(propertySchema),
      isNameEqualToKey: name === key
    }
  }

  private processFields(ctx: SchemaContext, schema: SchemaObject, properties: { [key: string]: SchemaObject }): TargetFieldMap {
    return Object.keys(properties).reduce((acc: TargetFieldMap, key: string) => {
      const propertySchema = properties[key]
      acc[key] = this.processField(ctx, schema, propertySchema, key)
      return acc
    }, {})
  }

  private processEnumField(schema: SchemaObject, key: string): EnumObject {
    const baseName = schema.title || key
    const name = this.target.enum(baseName)
    const enumDef = schema.enum as any[]

    return {
      name,
      type: EnumObjectType.Enum,
      isEnum: true,
      isOneOf: false,
      values: enumDef.map(x => {
        const def = x.toString()
        return {
          key: this.target.enumKey(def),
          value: def
        }
      })
    }
  }

  private processOneOfField(ctx: SchemaContext, schema: SchemaObject, prop: SchemaObject, key: string): {
    enumObj: EnumObject,
    interfaces: { [key: string]: string[] }
  } {
    const baseName = prop.title || key
    const name = this.target.interface(baseName)
    const oneOf = prop.oneOf as SchemaObject[]
    const { discriminator } = prop
    const oneOfProperties = oneOf[0].properties
    
    if (!(oneOfProperties && discriminator)) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`Object with oneOf definition is lacking a discriminator: ${schema.key}`)
    }

    const discriminatorValue = discriminator.propertyName
    const firstOne = oneOfProperties[discriminator.propertyName] as SchemaObject
    const interfaces: { [key: string]: string[] } = {}

    const values = oneOf.map((o) => {
      const v = {
        key: this.target.oneOfKey(o.key),
        type: resolveType(this.target, ctx, schema, key, o),
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
      discriminator: discriminatorValue,
      values,
      type: EnumObjectType.OneOf,
      isOneOf: true,
      isEnum: false,
      discriminatorType: firstOne.key,
      discriminatorVariable: this.target.variable(discriminatorValue)
    }

    return {
      enumObj,
      interfaces
    }
  }

  private processAllOf(ctx: SchemaContext, schema: SchemaObject): ModelAndInterfaces {
    const supermodel: TargetModel = {
      name: ctx.name(this.visitor),
      isEnum: false,
      values: [],
      interfaces: [],
      fields: {},
      enums: {},
      doc: schema.description
    }

    let superinterfaces = {}

    ctx.children.forEach((childCtx, childSchema) => {
      const { model, interfaces } = this.processModelObject(childCtx, childSchema)
      Object.assign(superinterfaces, interfaces)
      if (model != null) {
        supermodel.values = supermodel.values.concat(model.values)
        supermodel.interfaces = supermodel.interfaces.concat(model.interfaces)
        Object.assign(supermodel.fields, model.fields)
        Object.assign(supermodel.enums, model.enums)
      }
    })

    return {
      model: supermodel,
      interfaces: superinterfaces
    }
  }

  private processModelObject(ctx: SchemaContext, schema: SchemaObject): ModelAndInterfaces {
    if (ctx.combiner === "allOf") {
      return this.processAllOf(ctx, schema)
    }

    const { properties } = schema

    if (properties == null) {
      return {}
    }
  
    const fields = this.processFields(ctx, schema, properties)
    const modelInterfaces: { [key: string]: string[] } = {}
    const enums: { [key: string]: EnumObject } = {}

    ctx.children.forEach((childCtx, childSchema) => {
      if (!childCtx.isTransient) {
        return
      }

      if (childCtx.combiner) {
        if (childCtx.combiner === "allOf") {
          this.processAllOf(childCtx, childSchema)
        } else if (childCtx.combiner === "oneOf") {
          const { enumObj, interfaces } = this.processOneOfField(ctx, schema, childSchema, childCtx.name(this.visitor))
          // Merge given interfaces into output interface object
          Object.assign(modelInterfaces, interfaces)
          enums[enumObj.name] = enumObj
        }
      } else if (childSchema.enum) {
        const x = this.processEnumField(childSchema, childCtx.name(this.visitor))
        enums[x.name] = x
      }
    })

    const model: TargetModel = {
      name: this.target.cls(ctx.name(this.visitor)),
      isEnum: false,
      values: [],
      interfaces: [],
      fields,
      enums,
      doc: schema.description
    }

    return {
      model,
      interfaces: modelInterfaces
    }
  }

  private processSchema(ctx: SchemaContext, schema: SchemaObject): ModelAndInterfaces {
    if (schema.enum != null) {
      return { model: this.processEnum(ctx, schema) }
    }

    if (schema.allOf) {
      return this.processAllOf(ctx, schema)
    }

    if (schema.type === "array") {
      // tslint:disable-next-line:max-line-length
      const msg = schema.key + ": Array models cannot be represented in most programming languages. " +
        "Prefer an object and use the `items` property to generate a representable version of this model."
      logger.warn(msg)
      return {}
    }

    if (schema.type === "object") {
      return this.processModelObject(ctx, schema)
    }

    logger.warn(`Found unhandled entity '${pathAsString(ctx.path)}'`)
    return {}
  }

  generate(): { [key: string]: TargetModel } {
    const models: { [key: string]: TargetModel } = {}
    const modelInterfaces: { [key: string]: string[] } = {}

    this.visitor.schemas.forEach((ctx, schema) => {
        if (ctx.isTransient) {
            return
        }

        const { model, interfaces } = this.processSchema(ctx, schema)

        if (model != null) {
          // TODO: unsure if this is even close
          const k = ctx.name(this.visitor)
          models[k] = model
        }

        if (interfaces != null) {
          Object.assign(modelInterfaces, interfaces)
        }
    })

    // Assign all interfaces to the relevant models
    _.forEach(modelInterfaces, (nestedInterfaces, k: string) => {
      models[k].interfaces = nestedInterfaces
    })
    
    return models
  }
}

// console.log(x.schemas)
// console.log(x)


// const a = yaml.safeLoad(fs.readFileSync("./some.yaml", "utf8"))
// const x = new GeneratorVisitor(a)
// x.start()
// import KotlinTarget from "./targets/kotlin"
// const y = new ModelGenerator(new KotlinTarget({}), x)
// console.log(JSON.stringify(
//   y.generate().models.find(x => x.name === "BasicUserInfo"), null, 2
// ))