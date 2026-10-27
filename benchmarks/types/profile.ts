// Profiles the instantiations of a benchmark of this directory, to find the types that each call instantiates: `bun types/profile.ts FILE NAME [options]`.
// It checks FILE without its benchmarks plus 1 and then 10 copies of the callback of the benchmark NAME, and prints the instantiations per copy by label, `<alias or symbol name>|<TypeFlags>|<ObjectFlags>`, most first.
// It runs TypeScript 6 of `typescript-6`, patched by `patches/typescript@6.0.3.patch` to count instantiations by type; TypeScript 7 cannot be patched so, and counts nearly the same instantiations.
// - `--focus PREFIX`: a label that starts with PREFIX also lists the labels of its 6 enclosing instantiations, its type arguments as `<TypeFlags>:<name>`, and whether it is a deferred type reference.
// - `--relations PREFIX`: prints the stack of type comparisons that led to the first 2 instantiations of a label that starts with PREFIX.
// - `--save PROFILE` writes the counts per copy to PROFILE; `--compare PROFILE` prints the labels whose count per copy differs from that of a saved profile instead.
// TypeFlags in labels: 524288 type parameter, 1048576 object, 262144 `never`, 33554432 conditional type, 67108864 substitution type.

import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"

import ts from "typescript-6"

/** Number of copies of the callback whose instantiations, less those of one copy, give the count per copy. */
const copies = 10
/** Number of labels printed. */
const shown = 40

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    focus: { type: "string" },
    relations: { type: "string" },
    save: { type: "string" },
    compare: { type: "string" },
  },
})
const file = positionals[0]
const name = positionals[1]
if (file === undefined || name === undefined) {
  console.error("Pass a file of benchmarks and the name of a benchmark in it")
  process.exit(1)
}

/** Returns the `bench(...)` call that starts a statement of a benchmark, such as `bench(...).types()`. */
function findBenchCall(statement: ts.Statement): ts.CallExpression | undefined {
  if (!ts.isExpressionStatement(statement)) {
    return undefined
  }
  let expression = statement.expression
  while (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression)) {
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "bench"
    ) {
      return expression
    }
    expression = expression.expression
  }
  return undefined
}

const path = resolve(file)
const text = readFileSync(path, "utf8")
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
// Like Attest, the file without its benchmarks keeps the callback of `bench.baseline`.
let baseline = ""
let position = 0
let callback: string | undefined
for (const statement of source.statements) {
  const call = findBenchCall(statement)
  if (call === undefined) {
    continue
  }
  baseline += text.slice(position, statement.pos)
  position = statement.end
  const title = call.arguments[0]
  if (title !== undefined && ts.isStringLiteral(title) && title.text === name) {
    callback = call.arguments[1]?.getText(source)
  }
}
baseline += text.slice(position)
if (callback === undefined) {
  console.error(`No benchmark '${name}' with a callback in ${file}`)
  process.exit(1)
}

const tsc = createRequire(import.meta.url).resolve("typescript-6/lib/tsc.js")
const temporary = join(dirname(path), `.profile-${process.pid}`)

/** Checks the file without its benchmarks plus `count` copies of the callback, and returns its instantiations by label. */
function profile(count: number, env: Record<string, string>): Map<string, number> {
  const variant = `${temporary}-${count}.ts`
  const config = `${temporary}-${count}.tsconfig.json`
  const output = `${temporary}-${count}.tsv`
  let variantText = baseline
  for (let i = 0; i < count; i++) {
    variantText += `\nconst profiled${i} = ${callback}\n`
  }
  writeFileSync(variant, variantText)
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(import.meta.dirname, "tsconfig.consumer.json"),
      files: [basename(variant)],
      include: [],
    }),
  )
  try {
    const result = spawnSync("node", [tsc, "-p", config], {
      env: { ...process.env, ...env, INST_OUT: output },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    })
    // Type errors add instantiations of their elaboration, so the profile of a failing file misleads.
    if (result.status !== 0) {
      console.error(result.stdout)
      process.exit(1)
    }
    return readProfile(output)
  } finally {
    rmSync(variant, { force: true })
    rmSync(config, { force: true })
    rmSync(output, { force: true })
  }
}

/** Reads the lines `<count>\t<label>` of a profile. */
function readProfile(profilePath: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of readFileSync(profilePath, "utf8").split("\n")) {
    const tab = line.indexOf("\t")
    if (tab !== -1) {
      counts.set(line.slice(tab + 1), Number(line.slice(0, tab)))
    }
  }
  return counts
}

const options: Record<string, string> = {}
if (values.focus !== undefined) {
  options.INST_FOCUS = values.focus
}
const single = profile(
  1,
  values.relations === undefined ? options : { ...options, INST_RELATIONS: values.relations },
)
const multiple = profile(copies, options)
const perCopy = new Map<string, number>()
let total = 0
for (const label of new Set([...single.keys(), ...multiple.keys()])) {
  const count = ((multiple.get(label) ?? 0) - (single.get(label) ?? 0)) / (copies - 1)
  if (count !== 0) {
    perCopy.set(label, count)
    total += count
  }
}
console.log(`${total.toFixed(1)} instantiations per copy of '${name}'`)

if (values.compare === undefined) {
  const rows = [...perCopy].sort((a, b) => b[1] - a[1])
  for (const [label, count] of rows.slice(0, shown)) {
    console.log(`${count.toFixed(1).padStart(8)}  ${label}`)
  }
} else {
  const saved = readProfile(values.compare)
  const rows: [label: string, delta: number, before: number, after: number][] = []
  for (const label of new Set([...saved.keys(), ...perCopy.keys()])) {
    const before = saved.get(label) ?? 0
    const after = perCopy.get(label) ?? 0
    if (Math.abs(after - before) >= 0.5) {
      rows.push([label, after - before, before, after])
    }
  }
  rows.sort((a, b) => b[1] - a[1])
  for (const [label, delta, before, after] of rows.slice(0, shown)) {
    const sign = delta > 0 ? "+" : ""
    console.log(
      `${(sign + delta.toFixed(1)).padStart(8)}  ${before.toFixed(1).padStart(8)} -> ${after.toFixed(1).padEnd(8)}  ${label}`,
    )
  }
}
if (values.save !== undefined) {
  let lines = ""
  for (const [label, count] of perCopy) {
    lines += `${count}\t${label}\n`
  }
  writeFileSync(values.save, lines)
}
