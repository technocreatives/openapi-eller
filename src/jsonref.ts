import fs from "fs"
import objectPath from "object-path"

function findNode(url: URL, tree: any): any {
  return objectPath.get(tree, url.hash.substring(1).replace(/\//g, "."))
}

function resolveRef(leaf: any, tree: any) {
  for (const k in leaf) {
    const v = leaf[k]

    if (v != null && v.$ref != null) {
      let ref = new URL(v.$ref, "self://")

      if (ref.protocol === "file:") {
        const data = fs.readFileSync(ref.pathname, "utf8")
        leaf[k] = resolve(JSON.parse(data))
      } else if (ref.protocol === "self:" && ref.pathname === "") {
        leaf[k] = findNode(ref, tree)
      } else if (ref.protocol === "self:") {
        const data = fs.readFileSync(v.$ref.split("#")[0], "utf8")
        leaf[k] = resolve(JSON.parse(data))
      }
    } else if (Array.isArray(v)) {
      for (const o of v) {
        resolveRef(o, tree)
      }
    } else if (typeof v === "object") {
      resolveRef(v, tree)
    }
  }
}

export function resolve(tree: any): any {
  resolveRef(tree, tree)
  return tree
}
