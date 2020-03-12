import { ReferenceObject } from "openapi3-ts"

export function isRef(obj: any): obj is ReferenceObject {
  return (<ReferenceObject>obj).$ref !== undefined
}
