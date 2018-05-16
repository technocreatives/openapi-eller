import test from "ava"
import { loadTarget, generateArgumentsFromTree } from "../dist/index"

const testTree = {
  openapi: "3.0.0",
  info: { title: "Test Thing" },
  servers: [],
  paths: {
    "/test": {
      parameters: [
        {
          name: "parameterEnum",
          in: "query",
          schema: {
            type: "string",
            enum: ["yay", "nope"]
          }
        }
      ],
      get: {
        parameters: [
          {
            name: "anotherParameterEnum",
            in: "query",
            schema: {
              type: "string",
              enum: ["yay", "nope"]
            }
          }
        ],
        operationId: "testOperation",
        responses: {}
      }
    }
  },
  components: {
    schemas: {
      TopLevelObject: {
        type: "object",
        properties: {
          nestedField: {
            type: "object",
            properties: {
              deeperNestedField: {
                type: "object",
                properties: {
                  foo: {
                    type: "string"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

const target = loadTarget("kotlin", {})

test.beforeEach(async t => {
  t.context = { args: await generateArgumentsFromTree(target, testTree as any, {}) }
})

test("Nested fields generate correctly", t => {
  const { args } = t.context
  const generatedModels = Object.keys(args.models)
  console.error(args.models.TopLevelObject.fields)
  generatedModels.sort()
  console.error(generatedModels)
  t.deepEqual(generatedModels, [
    "TopLevelObject",
    "TopLevelObject_nestedField",
    "TopLevelObject_deeperNestedField",
    "testOperation_anotherParameterEnum",
    "testOperation_parameterEnum"
  ])
})