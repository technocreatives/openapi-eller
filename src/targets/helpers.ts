import hbs, { TemplateDelegate, HelperOptions } from "handlebars"
import path from "path"
import fs from "fs"

function handlebarsInstance(
  tmplPath: string,
  partialsDir: string
): TemplateDelegate {
  const instance = hbs.create()

  instance.registerHelper("indent", function indent(
    this: any,
    options: HelperOptions
  ) {
    const hash = options.hash || { size: 4 }
    const padding = Array((hash.size || 4) + 1).join(" ")
    const content = options.fn(this)
    return content
      .split("\n")
      .map(s => `${padding}${s}`.trimRight())
      .join("\n")
  })

  for (const partialFilename of fs.readdirSync(partialsDir)) {
    if (!partialFilename.endsWith(".hbs")) {
      continue
    }

    const partialBody = fs.readFileSync(
      path.join(partialsDir, partialFilename),
      "utf8"
    )
    instance.registerPartial(
      partialFilename
        .split(".")
        .slice(0, -1)
        .join("."),
      instance.compile(partialBody)
    )
  }

  return instance.compile(fs.readFileSync(tmplPath, "utf8"))
}

export {
  handlebarsInstance
}
