import test from "ava"
import path from "path"
import { loadTarget, generateArgumentsFromTarget } from "index"

test.beforeEach(async (t) => {
  const target = await loadTarget("kotlin", path.join(__dirname, "nested-field-test-schema.yml"), {})
  t.context = { args: await generateArgumentsFromTarget(target) }
})

test("Nested fields generate correctly", (t) => {
  const { args } = t.context as {[key: string]: any}

  t.truthy(args.models.TopLevelObject.fields.nestedField.fields.deeperNestedField)
  t.truthy(args.models.parameterEnum)
  t.truthy(args.models["testOperation.anotherParameterEnum"])
})
