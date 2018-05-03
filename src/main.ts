#!/usr/bin/env node

import fs from "fs"
import program from "commander"

const start = require("./index")
const targets = fs.readdirSync(`${__dirname}/targets`)
    .filter(x => x.indexOf(".") === -1)
    .join(", ")

program
  .name("openapi-eller")
  .version("0.1.0")
  // tslint:disable-next-line:max-line-length
  .description(`Generate API clients and servers for OpenAPI v3 specifications.\n\n  Available targets: ${targets}`)
  .arguments("<target> <input> [config]")
  .option("-o, --output [directory]", "The directory to output to")
  .option("-d, --debug", "Enable debug.json output")
  .action((target, input, config) => {
    start(target, input, config, program.output, program.debug)
      .then(() => process.exit(0))
      .catch((err: Error) => {
        console.error(err.stack)
        process.exit(1)
      })
  })
  .parse(process.argv)

if (!program.args.length) {
  program.help()
}
