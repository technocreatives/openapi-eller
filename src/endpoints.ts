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
import { GeneratorVisitor, SchemaContext } from "visitor";

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

console.log(responses)
  const firstObject = find(successResponse.content)
  console.log("FIRST!", successResponse.content)
  console.log("FIRST?", firstObject)

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

    if (!operationObject.operationId && !operationObject.summary) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`No operationId or summary found for route: ${JSON.stringify(operationObject)}`)
    }

    // TODO add req body
    const anonymousReqBodyName = `${target.cls(operationId)}Body`
    const anonymousResponseName = responseSchemaContext != null
      ? target.cls(responseSchemaContext.name(visitor))
      : null

    if (responseSchema != null && responseSchema.allOf) {
      console.error(responseSchema)
      console.error(anonymousResponseName)
    }

    const schemaType = resolveSchemaType(target, null, responseSchema || null, anonymousResponseName)
    const returnType = target.returnType(schemaType)

    if (!groups[group]) {
      groups[group] = {
        name: group,
        endpoints: []
      }
    }

    const operationParams = target.operationParams(operationObject, anonymousReqBodyName)
    const opParamDefaults = target.operationParamsDefaults(operationObject, anonymousReqBodyName)
      || operationParams

    groups[group].endpoints.push({
      operationId,
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
