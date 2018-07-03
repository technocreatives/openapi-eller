import { find, values } from "lodash"
import {
  Target,
  ConfigObject,
  TargetEndpointsGroup,
  OpenApiGenSchema
} from "types"
import {
  ResponseObject,
  ResponsesObject,
  SchemaObject
} from "openapi3-ts"

import { resolveSchemaType } from "./targets"
import { GeneratorVisitor, SchemaContext, isComplexType } from "visitor";

function findResponseSchema(responses: ResponsesObject): SchemaObject | undefined {
  const successResponse: ResponseObject = find(
    responses, 
    (responseObject: ResponseObject, statusCode) => {
      const statusCodeInt = parseInt(statusCode, 10)

      if (Number.isNaN(statusCodeInt)) {
        return false
      }

      return statusCodeInt >= 200 && statusCodeInt <= 299
    })
  
  if (!successResponse || !successResponse.content) {
    return
  }

  const firstObject = find(successResponse.content)

  if (firstObject && firstObject.schema != null) {
    return firstObject.schema as SchemaObject
  }
}

export function generateEndpoints(
  visitor: GeneratorVisitor,
  target: Target, 
  config: ConfigObject
): TargetEndpointsGroup[] | null {
  const isGroupingEnabled = config.useGroups || false
  const groups: {[groupName: string]: TargetEndpointsGroup} = {}
  
  for (const operationId in visitor.operations) {
    const operationObject = visitor.operations[operationId]
    
    if (config && config.include) {
      if (!operationObject.tags) {
        continue
      }

      const include = config.include
      if (!operationObject.tags.find((tag: string) => include.includes(tag))) {
        continue
      }
    }

    // Group routes by first tag if grouping is enabled
    const group = isGroupingEnabled && operationObject.tags
      ? target.cls(operationObject.tags[0])
      : ""
    
    if (!operationObject.responses) {
      throw new Error(`No responses field found for ${JSON.stringify(operationObject)}`)
    }

    let responseSchema: SchemaObject | undefined
    let responseSchemaContext: SchemaContext | undefined

    try {
      const r = findResponseSchema(operationObject.responses)
      if (r != null) {
        const rc = visitor.schemas.get(r)
        
        if (rc == null) {
          console.error("EEEEEE", r)
          throw new Error()
        }
        
        responseSchema = r
        responseSchemaContext = rc
      }
    } catch (err) {
      throw new Error(`Invalid response found for operationId: ${operationObject.operationId}`)
    }

    if (!operationObject.operationId) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`No operationId found for route: ${JSON.stringify(operationObject)}`)
    }

    const { requestBody } = operationObject
    let requestBodyContext: SchemaContext | undefined

    if (requestBody != null) {
      requestBodyContext = visitor.schemas.get(requestBody)
    }

    // TODO add req body
    const anonymousReqBodyName = requestBodyContext != null
      ? target.cls(requestBodyContext.name(visitor))
      : `${target.cls(operationId)}Body`
    const anonymousResponseName = responseSchemaContext != null
      ? target.cls(responseSchemaContext.name(visitor))
      : null

    if (responseSchema && responseSchema.type === "array") {
      console.log(responseSchema)
    }

    const schemaType = resolveSchemaType(target, null, responseSchema || null, anonymousResponseName)
    const returnType = target.returnType(schemaType)

    if (!groups[group]) {
      groups[group] = {
        name: group,
        endpoints: []
      }
    }

    // TODO: not this
    const paramNames = operationObject.parameters.reduce((acc, param) => {
      const { schema } = param
      if (schema == null || !isComplexType(schema)) {
        acc[param.name] = param.name
      } else {
        const ctx = visitor.schemas.get(schema)
        if (ctx == null) {
          console.log(schema)
          throw new Error('wat')
        }
        acc[param.name] = ctx.name(visitor)
      }
      return acc
    }, <{[key: string]: string}>{})

    const operationParams = target.operationParams(operationObject, anonymousReqBodyName, paramNames)
    // TODO: extra param with real names yo
    const opParamDefaults = target.operationParamsDefaults(operationObject, anonymousReqBodyName)
      || operationParams

    groups[group].endpoints.push({
      operationId: target.operationId(operationObject),
      returnType,
      httpMethod: target.httpMethod(operationObject.httpVerb),
      url: target.pathUrl(operationObject.urlPath),
      // TODO: reimplement per-endpoint security handling
      // security: target.security
      //     ? target.security(operationObject.security || [])
      //     : null,
      operationParams,
      operationParamsDefaults: opParamDefaults,
      operationArgs: target.operationArgs(operationObject, anonymousReqBodyName),
      operationKwargs: target.operationKwargs(operationObject, anonymousReqBodyName),
      requestParams: target.requestParams(operationObject, anonymousReqBodyName)
    })
  }

  return values(groups)
}
