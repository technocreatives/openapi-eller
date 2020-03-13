import fs from "fs"
import path from "path"
import program from "commander"
import { sync as mkdirpSync } from "mkdirp"

import { loadConfig, loadTarget, generateArgumentsFromTarget } from "index"
import { knownTargets } from "targets"

async function generateFromPath(
  targetName: string,
  yamlPath: string,
  configPath: string | undefined,
  outputPath: string = process.cwd(),
  isDebug: boolean = false
) {
  const absOutputPath = path.resolve(outputPath)

  const config = loadConfig(configPath)
  const target = await loadTarget(targetName, yamlPath, config)
  const args = await generateArgumentsFromTarget(target)

  if (isDebug) {
    fs.writeFileSync(path.join(absOutputPath, "debug.json"),
      JSON.stringify(args, null, 2), "utf8")
  }

  const files = target.generate(args)

  for (const fn in files) {
    const nfn = path.join(absOutputPath, fn)
    mkdirpSync(path.dirname(nfn))
    fs.writeFileSync(nfn, files[fn], "utf8")
  }
}

program
  .name("openapi-eller")
  .version("0.3.6")
  // tslint:disable-next-line:max-line-length
  .description(`Generate API clients and servers for OpenAPI v3 specifications.
  Available targets: ${knownTargets.join(", ")}
`)
  .arguments("<target> <input> [config]")
  .option("-o, --output [directory]", "The directory to output to")
  .option("-d, --debug", "Enable debug.json output")
  .action((targetName: string, yamlPath: string, configPath: string | undefined) => {
    generateFromPath(targetName, yamlPath, configPath, program.output, program.debug)
      .then(() => process.exit(0))
      .catch((err: Error) => {
        console.error(program.debug ? err.stack : `Error: ${err.message}`)
        process.exit(1)
      })
  })
  .parse(process.argv)

if (!program.args.length) {
  program.help()
}
