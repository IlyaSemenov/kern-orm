// Checks the boundaries of the workspaces of the repository, also for imports of types: kern-db imports no other package of the repository but the test harness in its tests, a workspace imports another one only by its name, and the other workspaces import kern-db only through its entry points.
// `paths` of the root `tsconfig.json` resolves every package of the repository in every workspace, so only this check keeps kern-db from importing them.
import { expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { parseAst } from "rolldown/parseAst"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const packageDir = "packages/db"

/** Directories of the workspaces of the repository, relative to its root. */
const workspaces = [
  ...["packages", "examples"].flatMap(dir =>
    readdirSync(join(root, dir)).map(name => `${dir}/${name}`),
  ),
  "benchmarks",
  "testing",
]

/** Returns the paths of the source files of `dirs`, relative to the root of the repository, skipping installed and built files. */
function listSourceFiles(dirs: string[]): string[] {
  const files: string[] = []
  const pending = [...dirs]
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") {
          pending.push(path)
        }
      } else if (/\.(?:ts|mts|mjs|js)$/.test(entry.name)) {
        files.push(path)
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

/** Returns the path, relative to the root of the repository, of the module that the relative import `specifier` of `file` names. */
function resolveRelative(file: string, specifier: string): string {
  return relative(root, resolve(root, dirname(file), specifier))
    .split(sep)
    .join("/")
}

/** Tells whether `path` is inside directory `dir`, both relative to the root of the repository. */
function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

/** Tells whether `specifier` names a package of the repository other than kern-db. */
function isOtherPackage(specifier: string): boolean {
  return /^(?:kern-orm|kern-migrations|@kern-orm\/[^/]+)(?:\/|$)/.test(specifier)
}

/** Tells whether `file` of kern-db is a test or a test helper of a module, which may import the test harness; the entry point `src/testing.ts` is neither. */
function isTestFile(file: string): boolean {
  return (
    /\.(?:test|type-test)\.ts$/.test(file) ||
    /^packages\/db\/src\/.+\/testing\.ts$/.test(file) ||
    isInside(file, `${packageDir}/tests`)
  )
}

/** Returns the imports of `files` that `isViolation` rejects, as `<file>: <specifier>`; `null` stands for a module named by an expression. */
function findViolations(
  files: string[],
  isViolation: (file: string, specifier: string | null) => boolean,
): string[] {
  const violations: string[] = []
  for (const file of files) {
    for (const specifier of readImports(file, readFileSync(join(root, file), "utf8"))) {
      if (isViolation(file, specifier)) {
        violations.push(`${file}: ${specifier ?? "a module named by an expression"}`)
      }
    }
  }
  return violations
}

it("kern-db imports no other package of the repository but the test harness in its tests", () => {
  const violations = findViolations(listSourceFiles([packageDir]), (file, specifier) =>
    specifier === null
      ? true
      : !specifier.startsWith(".") &&
        isOtherPackage(specifier) &&
        !(specifier.startsWith("@kern-orm/test-harness/") && isTestFile(file)),
  )

  expect(violations).toEqual([])
})

it("a workspace imports no module of another workspace by a relative path", () => {
  const violations: string[] = []
  for (const workspace of workspaces) {
    violations.push(
      ...findViolations(
        listSourceFiles([workspace]),
        (file, specifier) =>
          specifier !== null &&
          specifier.startsWith(".") &&
          !isInside(resolveRelative(file, specifier), workspace),
      ),
    )
  }

  expect(violations).toEqual([])
})

it("the other workspaces import kern-db only through its entry points", () => {
  const files = listSourceFiles(workspaces.filter(dir => dir !== packageDir))
  // A module of kern-db other than its entry points, which its exports do not resolve.
  const violations = findViolations(
    files,
    (_, specifier) => specifier !== null && /^kern-db\/(?:src|dist)(?:\/|$)/.test(specifier),
  )

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
  expect(resolveRelative("packages/orm/src/query/select.ts", "../../../db/src/result")).toBe(
    "packages/db/src/result",
  )
  expect(isOtherPackage("kern-orm/db")).toBe(true)
  expect(isOtherPackage("@kern-orm/migrations")).toBe(true)
  expect(isOtherPackage("kern-db/types")).toBe(false)
  expect(isOtherPackage("kern-ormish")).toBe(false)
  expect(isTestFile("packages/db/src/transaction/testing.ts")).toBe(true)
  expect(isTestFile("packages/db/src/testing.ts")).toBe(false)
})
