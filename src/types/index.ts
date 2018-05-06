import { 
  OpenAPIObject,
  SchemaObject,
  ComponentsObject,
  SecuritySchemeObject,
  OAuthFlowObject,
  ReferenceObject,
  SecurityRequirementObject,
  OperationObject,
  ServerObject,
} from "openapi3-ts"

export interface OpenApiGenTree extends OpenAPIObject {
  components?: OpenApiGenComponents
  servers: ServerObject[]
}

export interface OpenApiGenComponents extends ComponentsObject {
  schemas?: {
    [schema: string]: OpenApiGenSchema;
  }
  securitySchemes?: {
    [securityScheme: string]: OpenApiGenSecuritySchemeObject;
  }
}

export interface OpenApiGenSchema extends SchemaObject {
  key: string
  properties?: {
    [propertyName: string]: (OpenApiGenSchema | ReferenceObject);
  }
  additionalProperties?: (OpenApiGenSchema | ReferenceObject)
  oneOf?: (OpenApiGenSchema | ReferenceObject)[]
  items?: OpenApiGenSchema | ReferenceObject
  hasModelTitle?: boolean
}

export enum SecuritySchemeType {
  HTTP = "http",
  ApiKey = "apiKey",
  OAuth2 = "oauth2",
  OpenIdConnect = "openIdConnect"
}

export interface OpenApiGenSecuritySchemeObject extends SecuritySchemeObject {
  type: SecuritySchemeType
  flows?: OAuthFlowObject
  in?: ParameterLocation
  scheme?: string
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
    [formatKey: string]: string,
  }}
  fieldRenames?: {[schemaKey: string]: {
    [fieldKey: string]: string;
  }}
  useGroups?: boolean
  include?: string[]
}

export abstract class Target {
  config: ConfigObject

  constructor(config: ConfigObject) {
    this.config = config
  }

  abstract types: TargetTypeMap

  abstract cls(key: string, isNested?: boolean): string
  abstract enumKey(string: string): string
  abstract oneOfKey(string: string): string
  abstract modelDoc(schema: OpenApiGenSchema): string | undefined
  abstract fieldDoc(schema: OpenApiGenSchema): string | undefined
  abstract variable(basename: string): string
  abstract isHashable(type: string): boolean
  abstract operationId(route: SchemaObject): string
  abstract pathUrl(routePath: string): string
  abstract httpMethod(method: string): string
  abstract url(thing: string): string
  abstract servers(servers: ServerObject[]): TargetServer[]
  abstract generate(args: GenerateArguments): { [filename: string]: string }
  abstract operationParams(route: OperationObject, bodyName: string): string
  
  operationParamsDefaults(route: OperationObject, bodyName: string): string | undefined {
    return
  }
  
  operationArgs(route: OperationObject, bodyName: string): string | undefined {
    return
  }

  operationKwargs(route: OperationObject, bodyName: string): string | undefined {
    return
  }

  requestParams(route: OperationObject, bodyName: string): string | undefined {
    return
  }

  returnType(schemaType: string): string {
    return schemaType
  }

  optional(type: string): string {
    return type
  }

  format(schema: OpenApiGenSchema): string | undefined {
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
  modelDoc(schema: OpenApiGenSchema): string
  fieldDoc(schema: OpenApiGenSchema): string
  variable(basename: string): string
  isHashable(type: string): boolean
  format?(schema: OpenApiGenSchema): string
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
  operationParams(route: OperationObject, bodyName: string): string
  operationParamsDefaults?(route: OperationObject, bodyName: string): string
  operationArgs?(route: OperationObject, bodyName: string): string
  operationKwargs?(route: OperationObject, bodyName: string): string
  requestParams?(route: OperationObject, bodyName: string): string
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
  isOauth2?: boolean
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
}

export interface TargetModel {
  name: string
  type: string
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
  key: string
  doc: string | undefined
  isHashable: boolean
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
  map: string
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
