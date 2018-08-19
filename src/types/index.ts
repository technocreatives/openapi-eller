import { 
  SchemaObject,
  SecuritySchemeObject,
  OAuthFlowObject,
  SecurityRequirementObject,
  ServerObject
} from "openapi3-ts"
import { Operation, GeneratorVisitor } from "visitor"

export enum SecuritySchemeType {
  HTTP = "http",
  ApiKey = "apiKey",
  OAuth2 = "oauth2",
  OpenIdConnect = "openIdConnect"
}

export enum ParameterLocation {
  Header = "header",
  Query = "query"
}

export enum SecuritySchemeObjectScheme {
  Basic = "basic",
  Bearer = "bearer",
  Digest = "digest"
}

export interface ConfigObject {
  namespace?: string
  renames?: { [schemaKey: string]: string }
  types?: { [typeKey: string]: {
    [formatKey: string]: string
  }}
  fieldRenames?: {[schemaKey: string]: {
    [fieldKey: string]: string
  }}
  useGroups?: boolean
  include?: string[]
  prefix?: string
}

export abstract class Target {
  visitor: GeneratorVisitor
  config: ConfigObject

  constructor(visitor: GeneratorVisitor, config: ConfigObject) {
    this.visitor = visitor
    this.config = config
  }

  abstract types: TargetTypeMap

  abstract cls(key: string, isNested?: boolean): string
  abstract enumKey(string: string): string
  abstract oneOfKey(string: string): string
  abstract modelDoc(schema: SchemaObject): string | undefined
  abstract fieldDoc(schema: SchemaObject): string | undefined
  abstract variable(basename: string): string
  abstract isHashable(type: string): boolean
  abstract operationId(route: SchemaObject): string
  abstract pathUrl(routePath: string): string
  abstract httpMethod(method: string): string
  abstract url(thing: string): string
  abstract servers(servers: ServerObject[]): TargetServer[]
  abstract generate(args: GenerateArguments): { [filename: string]: string }
  abstract operationParams(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string
  
  operationParamsDefaults(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string | undefined {
    return
  }
  
  operationArgs(route: Operation, bodyName: string): string | undefined {
    return
  }

  operationKwargs(route: Operation, bodyName: string): string | undefined {
    return
  }

  requestParams(route: Operation, bodyName: string): string | undefined {
    return
  }

  returnType(schemaType: string): string {
    return schemaType
  }

  optional(type: string): string {
    return type
  }

  format(schema: SchemaObject): string | undefined {
    return
  }

  interface(basename: string): string {
    return this.cls(basename)
  }

  enum(basename: string): string {
    return this.cls(basename)
  }
}

export interface TargetObject {
  name?: string
  type?: string
  config?: ConfigObject
  cls(key: string, isNested?: boolean): string
  enumKey(string: string): string
  oneOfKey(key: string): string
  modelDoc(schema: SchemaObject): string
  fieldDoc(schema: SchemaObject): string
  variable(basename: string): string
  isHashable(type: string): boolean
  format?(schema: SchemaObject): string
  interface?(baseName: string): string
  enum?(basename: string): string
  operationId(route: SchemaObject): string
  returnType?(schemaType: string): string
  pathUrl(routePath: string): string
  httpMethod(httpMethod: string): string
  security?(security: SecurityRequirementObject[]): {
    name: string;
    values: object;
  }[]
  operationParams(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string
  operationParamsDefaults?(route: Operation, bodyName: string, paramNames: { [key: string]: string }): string
  operationArgs?(route: Operation, bodyName: string): string
  operationKwargs?(route: Operation, bodyName: string): string
  requestParams?(route: Operation, bodyName: string): string
  optional?(type: string): string
  types: TargetTypeMap

  url(thing: string): string
  servers(servers: ServerObject[]): TargetServer[]
  generate(args: GenerateArguments): { [filename: string]: string }
}

export interface TargetServer {
  url: string
  description: string
  variables: string
  replacements: {
    key: string;
    value: string;
  }[]
}

export interface TargetSecuritySchemes {
  name: string
  isOAuth2?: boolean
  isOpenIdConnect?: boolean
  openIdConnectUrl?: string
  isAuthorizationCode?: boolean
  scopes?: {
    name: string;
    value: string;
  }[]
  key?: string
  isApiKey?: boolean
  inHeader?: boolean
  inQuery?: boolean
  isHttp?: boolean
  isBasic?: boolean
  isDigest?: boolean
  isBearer?: boolean
}

export interface TargetModel {
  name: string
  type?: string | undefined
  isEnum: boolean
  values: {
    key: string;
    value: string;
  }[]
  interfaces: string[]
  fields: {[fieldName: string]: TargetField}
  enums: {[key: string]: EnumObject}
  doc: string | undefined
}

export interface TargetField {
  name: string
  type: string
  rawType: string
  key: string
  fields: TargetFieldMap
  doc: string | undefined
  isHashable: boolean
  isNested: boolean
  isEnum: boolean
  isOneOf: boolean
  isOptional: boolean
  format: string | undefined
  isNameEqualToKey: boolean
}

export interface EnumObject {
  name: string
  values: {
    key: string;
    value: any;
    type?: string;
  }[]
  type: EnumObjectType
  isOneOf: boolean
  isEnum: boolean
  discriminator?: string
  discriminatorType?: string
  discriminatorVariable?: string
}

export enum EnumObjectType {
  OneOf = "oneOf",
  Enum = "enum"
}

export interface TargetEndpoint {
  operationId: string
  returnType: string
  httpMethod: string
  url: string
  // TODO: why do we need this?
  // security?: {
  //   name: string;
  //   values: object;
  // }[] | null;
  operationParams: string
  operationParamsDefaults: string
  operationArgs: string | undefined
  operationKwargs: string | undefined
  requestParams: string | undefined
}

export interface TargetEndpointsGroup {
  name: string
  endpoints: TargetEndpoint[]
}

export interface TargetFormatMap {
  [key: string]: string
}

export interface TargetTypeMap {
  integer: TargetFormatMap
  string: TargetFormatMap
  number: TargetFormatMap
  boolean: TargetFormatMap
  array: string
  map: TargetFormatMap
  set: string
  null: string
  [typeKey: string]: TargetFormatMap | string
}

export interface GenerateArguments {
  config: ConfigObject
  // TODO: Be more specific here, maybe try to unify the object signature in one
  security: {}[]
  servers: TargetServer[]
  name: string
  groups: TargetEndpointsGroup[] | null
  models: { [key: string]: TargetModel }
}

export type TargetFieldMap = { [key: string]: TargetField }
