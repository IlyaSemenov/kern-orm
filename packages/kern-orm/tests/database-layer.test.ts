// Checks that the database layer works without the ORM: its modules, entry points, tests, and test harness import no module of the ORM, also for types.
import { expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { parseAst } from "rolldown/parseAst"

const packageDir = fileURLToPath(new URL("..", import.meta.url))

// Directories of the layer, with every file in them, and its other files: its entry points and the tests of the test helpers with the test runners.
const layerDirs = ["src/database", "testing/database", "tests/runner"]
const layerFiles = [
  "src/db.ts",
  "src/db/types.ts",
  "src/db/types.test.ts",
  "src/testing.ts",
  "tests/test-runner.test.ts",
]

// Entry points of `kern-orm` that export only the layer.
const layerEntryPoints = ["kern-orm/db", "kern-orm/db/types", "kern-orm/testing"]
// Driver packages that the layer harness runs tests on; they move into the layer with the package of the layer.
const driverPackages = ["@kern-orm/postgres-js", "@kern-orm/node-postgres"]

/** Returns the paths of the files of the layer, relative to the package. */
function listLayerFiles(): string[] {
  const files = [...layerFiles]
  for (const dir of layerDirs) {
    for (const file of readdirSync(join(packageDir, dir), { recursive: true, encoding: "utf8" })) {
      if (/\.(?:ts|mts|mjs|js)$/.test(file)) {
        files.push(join(dir, file).split(sep).join("/"))
      }
    }
  }
  return files
}

/** Returns the specifiers of the modules that the source of `file` imports, also only for types, and `null` for a module named by an expression, which the check cannot tell. */
function readImports(file: string, source: string): (string | null)[] {
  const specifiers: (string | null)[] = []
  /** Collects the module that `node` names, if it names one, and visits its children. */
  function visit(node: unknown): void {
    if (typeof node !== "object" || node === null) {
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child)
      }
      return
    }
    const { type } = node as { type?: unknown }
    // Declarations of imports and exports from a module, dynamic imports, and import types, such as `typeof import("x")`, name the module by `source`.
    if (
      type === "ImportDeclaration" ||
      type === "ExportAllDeclaration" ||
      (type === "ExportNamedDeclaration" && (node as { source: unknown }).source !== null) ||
      type === "ImportExpression" ||
      type === "TSImportType"
    ) {
      specifiers.push(readSpecifier((node as { source: unknown }).source))
    } else if (type === "TSExternalModuleReference") {
      specifiers.push(readSpecifier((node as { expression: unknown }).expression))
    } else if (
      type === "CallExpression" &&
      (node as { callee: { type: string; name?: string } }).callee.type === "Identifier" &&
      (node as { callee: { name?: string } }).callee.name === "require"
    ) {
      specifiers.push(readSpecifier((node as { arguments: unknown[] }).arguments[0]))
    }
    for (const value of Object.values(node)) {
      visit(value)
    }
  }
  visit(parseAst(source, { lang: /\.m?ts$/.test(file) ? "ts" : "js" }, file))
  return specifiers
}

/** Returns the module that an expression of an import names: a string, or a template without substitutions; `null` for another expression. */
function readSpecifier(node: unknown): string | null {
  const { type, value, expressions, quasis } = node as {
    type?: string
    value?: unknown
    expressions?: unknown[]
    quasis?: { value: { cooked: string } }[]
  }
  if (type === "Literal" && typeof value === "string") {
    return value
  }
  if (type === "TemplateLiteral" && expressions!.length === 0) {
    return quasis![0]!.value.cooked
  }
  return null
}

/** Tells whether a relative import of `file` resolves to a module of the layer. */
function isLayerModule(file: string, specifier: string): boolean {
  const target = relative(packageDir, resolve(packageDir, dirname(file), specifier))
    .split(sep)
    .join("/")
  return (
    layerDirs.some(dir => target.startsWith(`${dir}/`)) ||
    layerFiles.some(layerFile => layerFile.replace(/\.ts$/, "") === target)
  )
}

/** Tells whether a file of the layer may import a package by `specifier`. */
function isAllowedPackage(specifier: string): boolean {
  if (specifier === "kern-orm" || specifier.startsWith("kern-orm/")) {
    return layerEntryPoints.includes(specifier)
  }
  if (specifier.startsWith("@kern-orm/")) {
    return driverPackages.includes(specifier)
  }
  return true
}

it("imports no module of the ORM", () => {
  const violations: string[] = []
  for (const file of listLayerFiles()) {
    for (const specifier of readImports(file, readFileSync(join(packageDir, file), "utf8"))) {
      const allowed =
        specifier !== null &&
        (specifier.startsWith(".") ? isLayerModule(file, specifier) : isAllowedPackage(specifier))
      if (!allowed) {
        violations.push(`${file}: ${specifier ?? "a module named by an expression"}`)
      }
    }
  }

  expect(violations).toEqual([])
})

it("reads every kind of import", () => {
  const source = `
    import {
      // The ORM's database.
      a,
    } from "./a"
    import type { B } from "kern-orm"
    export * from "../c"
    export { d } from "./d"
    import "./e"
    type F = typeof import("../../f")
    type G = import("./g").G
    const h = await import(\`kern-orm/types\`)
    import i = require("./i")
    const j = require("./j")
    const k = await import(path)
  `

  expect(readImports("source.ts", source)).toEqual([
    "./a",
    "kern-orm",
    "../c",
    "./d",
    "./e",
    "../../f",
    "./g",
    "kern-orm/types",
    "./i",
    "./j",
    null,
  ])
  expect(isLayerModule("src/database/sql/query.ts", "../../execution/database")).toBe(false)
  expect(isLayerModule("src/database/sql/query.ts", "../driver")).toBe(true)
  expect(isLayerModule("src/testing.ts", "./database/testing")).toBe(true)
  expect(isLayerModule("src/testing.ts", "./types")).toBe(false)
})
