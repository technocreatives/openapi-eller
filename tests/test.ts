import test from "ava"
import path from "path"
import { loadTarget, generateArgumentsFromTarget } from "index"

test.beforeEach(async (t) => {
  const target = await loadTarget("kotlin", path.join(__dirname, "nested-field-test-schema.yml"), {})
  t.context = { args: await generateArgumentsFromTarget(target) }
})

test("Nested fields generate correctly", (t) => {
  const { args } = t.context
  const generatedModels = Object.keys(args.models)
  generatedModels.sort()
  t.deepEqual(generatedModels, [
    "TopLevelObject",
    "TopLevelObject_nestedField",
    "TopLevelObject_deeperNestedField",
    "testOperation_anotherParameterEnum",
    "testOperation_parameterEnum"
  ])
})
