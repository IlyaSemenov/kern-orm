// Checks the packed packages as a consumer project installs them; the `test:package` script builds them first.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "esbuild"
import { rolldown } from "rolldown"

const root = join(import.meta.dir, "../../../..")
const packageDirs = ["packages/kern-orm", "packages/postgres-js"]

const compileOnlyOutput = {
  text: 'SELECT "form"."name" AS "name" FROM "form" AS "form" WHERE "form"."name" = $1',
  parameters: ["Survey"],
}

const consumerOutput = {
  text: 'SELECT "form"."id" AS "id" FROM "app"."form" AS "form" WHERE "form"."name" = $1',
  parameters: ["Survey"],
  record: { id: "form-id" },
}

let consumer: string

beforeAll(async () => {
  consumer = await mkdtemp(join(tmpdir(), "kern-orm-consumer-"))
  // Assemble node_modules without network: the packed packages, and the dependencies they leave to the consumer.
  for (const dir of packageDirs) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    const tarball = run(
      ["bun", "pm", "pack", "--quiet", "--destination", consumer],
      join(root, dir),
    )
    const target = join(consumer, "node_modules", name)
    await mkdir(target, { recursive: true })
    run(["tar", "-xzf", tarball.trim(), "-C", target, "--strip-components=1"], consumer)
  }
  await mkdir(join(consumer, "node_modules/@types"))
  await symlink(
    join(root, "packages/postgres-js/node_modules/postgres"),
    join(consumer, "node_modules/postgres"),
  )
  await symlink(join(root, "node_modules/@types/node"), join(consumer, "node_modules/@types/node"))
  await symlink(join(root, "node_modules/@types/bun"), join(consumer, "node_modules/@types/bun"))
  await symlink(join(root, "node_modules/vitest"), join(consumer, "node_modules/vitest"))
  await cp(join(import.meta.dir, "fixtures"), consumer, { recursive: true })
  await writeFile(join(consumer, "package.json"), JSON.stringify({ type: "module" }))
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        target: "esnext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "declarations",
        types: ["node"],
      },
      include: ["*.ts"],
    }),
  )
  await writeFile(
    join(consumer, "tsconfig.declarations.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        noEmit: true,
        emitDeclarationOnly: false,
        skipLibCheck: false,
      },
      include: ["declarations/*.d.ts"],
      exclude: [],
    }),
  )
  await writeFile(
    join(consumer, "tsconfig.type-tests.json"),
    JSON.stringify({
      extends: "./tsconfig.declarations.json",
      compilerOptions: {
        // Bun's ambient types fail the library check; tsconfig.declarations.json checks the emitted declarations without them.
        skipLibCheck: true,
        types: ["bun"],
      },
      include: ["declaration-consumer/*.type-test.ts"],
    }),
  )
}, 60_000)

afterAll(async () => {
  await rm(consumer, { recursive: true, force: true })
})

test("emits declarations and type-checks their consumer with Node.js module resolution", () => {
  run([join(root, "node_modules/.bin/tsc"), "-p", consumer], consumer)
  run([join(root, "node_modules/.bin/tsc"), "-p", "tsconfig.declarations.json"], consumer)
  run([join(root, "node_modules/.bin/tsc"), "-p", "tsconfig.type-tests.json"], consumer)
}, 60_000)

describe.each(["node", "bun"])("%s", runtime => {
  test("runs a consumer", () => {
    expect(JSON.parse(run([runtime, "consumer.ts"], consumer))).toEqual(consumerOutput)
  })
})

describe("test runners", () => {
  // Statements of the fixture of a test file or describe block with one test.
  const getFileStatements = (testStatements: string[]) => [
    "SAVEPOINT kern_1",
    "SAVEPOINT kern_2",
    "file data",
    "RELEASE SAVEPOINT kern_2",
    "SAVEPOINT kern_2",
    ...testStatements,
    "ROLLBACK TO SAVEPOINT kern_2",
    "RELEASE SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
  ]

  // Statements of a fixture whose seed never settles, closed after its before hook times out.
  const stuckStatements = [
    "SAVEPOINT kern_1",
    "SAVEPOINT kern_2",
    "stuck data",
    "ROLLBACK TO SAVEPOINT kern_2",
    "RELEASE SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
  ]

  // Statements of a test process: the fixture of the run around the fixtures of its test files.
  const getProcessStatements = (...files: string[][]) => [
    "BEGIN",
    "SAVEPOINT kern_1",
    "migrate",
    "RELEASE SAVEPOINT kern_1",
    ...files.flat(),
    "ROLLBACK",
    "release",
  ]

  /** Runs a test runner in a scenario directory and returns the recorded statements of each process; a scenario with failing tests expects a nonzero exit code. */
  async function runScenario(name: string, cmd: string[], { failing = false } = {}) {
    const log = join(consumer, `${name}.log`)
    const cwd = join(consumer, "runners", name)
    const result = Bun.spawnSync({ cmd, cwd, env: { ...process.env, LOG: log } })
    if ((result.exitCode !== 0) !== failing) {
      throw new Error(`${cmd.join(" ")} failed:\n${result.stdout}${result.stderr}`)
    }
    const byProcess = new Map<number, string[]>()
    for (const line of (await readFile(log, "utf8")).trim().split("\n")) {
      const { pid, text } = JSON.parse(line) as { pid: number; text: string }
      byProcess.set(pid, [...(byProcess.get(pid) ?? []), text])
    }
    return [...byProcess.values()]
  }

  test("node:test runs a fixture of the run from --import and a fixture of each file", async () => {
    const statements = await runScenario("node", [
      "node",
      "--import",
      "./preload.mjs",
      "--test",
      "file-1.mjs",
      "file-2.mjs",
    ])

    expect(statements).toEqual([
      getProcessStatements(getFileStatements(["test"])),
      getProcessStatements(getFileStatements(["test"])),
    ])
  }, 60_000)

  test("node:test with --test-isolation=none runs the fixtures of describe blocks in one process", async () => {
    const statements = await runScenario("node-isolation-none", [
      "node",
      "--import",
      "../node/preload.mjs",
      "--test",
      "--test-isolation=none",
      "file-1.mjs",
      "file-2.mjs",
    ])

    expect(statements).toEqual([
      getProcessStatements(getFileStatements(["test"]), getFileStatements(["test"])),
    ])
  }, 60_000)

  test("node:test closes a fixture whose seed never settles after its before hook times out", async () => {
    const statements = await runScenario(
      "node-stuck-seed",
      ["node", "--import", "../node/preload.mjs", "--test", "file-1.mjs", "file-2.mjs"],
      { failing: true },
    )

    // The test files run in parallel processes, in any order.
    expect(statements).toHaveLength(2)
    expect(statements).toEqual(
      expect.arrayContaining([
        getProcessStatements(stuckStatements, getFileStatements(["test"])),
        // The after hook of --import runs first and closes the fixture of the file while it still opens.
        getProcessStatements(stuckStatements),
      ]),
    )
  }, 60_000)

  test("Vitest runs each test with its hooks in a test transaction of aroundEach", async () => {
    const statements = await runScenario("vitest", [
      "node",
      join(consumer, "node_modules/vitest/vitest.mjs"),
      "run",
    ])

    expect(statements).toEqual([
      getProcessStatements(getFileStatements(["before each", "test"])),
      getProcessStatements(getFileStatements(["before each", "test"])),
    ])
  }, 60_000)

  test("Vitest closes a fixture whose seed never settles after its before hook times out", async () => {
    const statements = await runScenario(
      "vitest-stuck-seed",
      ["node", join(consumer, "node_modules/vitest/vitest.mjs"), "run"],
      { failing: true },
    )

    expect(statements).toEqual([getProcessStatements(stuckStatements, getFileStatements(["test"]))])
  }, 60_000)
})

const bundlers = {
  async esbuild(entry: string) {
    const result = await build({
      entryPoints: [join(consumer, entry)],
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["postgres"],
      write: false,
    })
    return result.outputFiles[0]!.text
  },
  async rolldown(entry: string) {
    const bundle = await rolldown({
      input: join(consumer, entry),
      platform: "node",
      external: ["postgres"],
    })
    const { output } = await bundle.generate({ format: "esm" })
    return output[0].code
  },
}

describe.each(Object.keys(bundlers) as (keyof typeof bundlers)[])("%s", bundler => {
  test("drops unused types and execution code of a compile-only consumer", async () => {
    const code = await bundlers[bundler]("compile-only.ts")

    // Markers of the transaction coordinator and of unused built-in types.
    const markers = ["AsyncLocalStorage", "timestamptz", "jsonb"]
    expect(markers.filter(marker => code.includes(marker))).toEqual([])
    const file = join(consumer, `compile-only.${bundler}.mjs`)
    await writeFile(file, code)
    expect(JSON.parse(run(["node", file], consumer))).toEqual(compileOnlyOutput)
  })

  test("keeps the execution code a consumer uses", async () => {
    expect((await bundlers[bundler]("consumer.ts")).includes("AsyncLocalStorage")).toBe(true)
  })
})

/** Runs a command in `cwd` and returns its standard output, throwing with its standard error on failure. */
function run(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync({ cmd, cwd })
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.toString()
}
