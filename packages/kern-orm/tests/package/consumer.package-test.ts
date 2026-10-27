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
  pageText:
    'SELECT (SELECT coalesce(json_agg(json_build_array(CASE WHEN "subquery"."name" IS NOT DISTINCT FROM NULL THEN NULL ELSE format(\'%s\', "subquery"."name") END)), \'[]\'::json) AS "rows" FROM (SELECT "form"."name" AS "name" FROM "app"."form" AS "form") AS "subquery") AS "names"',
}

let consumer: string

beforeAll(async () => {
  consumer = await mkdtemp(join(tmpdir(), "kern-orm-consumer-"))
  // Assemble node_modules without network: the packed packages, and the dependencies they leave to the consumer.
  for (const dir of packageDirs) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    // `changeset publish` publishes with npm, which, unlike Bun, leaves protocols such as `catalog:` as they are.
    const [{ filename }] = JSON.parse(
      run(["npm", "pack", "--json", "--pack-destination", consumer], join(root, dir)),
    ) as [{ filename: string }]
    const target = join(consumer, "node_modules", name)
    await mkdir(target, { recursive: true })
    run(["tar", "-xzf", filename, "-C", target, "--strip-components=1"], consumer)
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
  await writeFile(
    join(consumer, "tsconfig.primary-key.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        noEmit: true,
        emitDeclarationOnly: false,
      },
      include: ["primary-key/*.ts"],
    }),
  )
  await writeFile(
    join(consumer, "tsconfig.primary-key-without-strict-null-checks.json"),
    JSON.stringify({
      extends: "./tsconfig.primary-key.json",
      compilerOptions: {
        strictNullChecks: false,
      },
    }),
  )
}, 60_000)

afterAll(async () => {
  await rm(consumer, { recursive: true, force: true })
})

test("publishes dependencies without the catalog: and workspace: protocols", async () => {
  const protocols: string[] = []
  for (const dir of packageDirs) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    const manifest = await Bun.file(join(consumer, "node_modules", name, "package.json")).json()
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const [dependency, range] of Object.entries<string>(manifest[field] ?? {})) {
        if (/^(catalog|workspace):/.test(range)) {
          protocols.push(`${name} ${field} ${dependency}: ${range}`)
        }
      }
    }
  }
  expect(protocols).toEqual([])
})

describe.each([
  ["pinned", [join(root, "node_modules/.bin/tsc")]],
  // The minimum version that consumers need, as the install section of docs/getting-started.md states.
  ["minimum", ["node", Bun.resolveSync("typescript-6/lib/tsc.js", import.meta.dir)]],
])("TypeScript %s", (_, tsc) => {
  test("emits declarations and type-checks their consumer with Node.js module resolution", () => {
    run([...tsc, "-p", consumer], consumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], consumer)
    run([...tsc, "-p", "tsconfig.type-tests.json"], consumer)
  }, 60_000)

  test("names the reason in the errors of primaryKey() of a nullable type and column", () => {
    expect(getTypeErrorReasons(tsc, "tsconfig.primary-key.json")).toEqual([
      "primary key columns must not be nullable",
      "primary key columns must not be nullable",
    ])
  }, 60_000)

  test("names strictNullChecks in the errors of primaryKey() of a consumer without it", () => {
    expect(
      getTypeErrorReasons(tsc, "tsconfig.primary-key-without-strict-null-checks.json"),
    ).toEqual([
      "kern-orm requires strictNullChecks",
      "kern-orm requires strictNullChecks",
      "kern-orm requires strictNullChecks",
      "kern-orm requires strictNullChecks",
    ])
  }, 60_000)
})

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
    const result = Bun.spawnSync({
      cmd,
      cwd,
      env: { ...process.env, LOG: log },
      // `spawnSync` blocks the event loop, so the timeout of the calling test cannot stop a runner that hangs.
      timeout: 30_000,
    })
    if (result.exitedDueToTimeout) {
      throw new Error(`${cmd.join(" ")} timed out:\n${result.stdout}${result.stderr}`)
    }
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

  describe.skipIf(!process.env.DATABASE_URL)("in PostgreSQL", () => {
    const getOutcomes = (timedOut: string) =>
      ["in a fixture", "without a fixture"].flatMap(block => [
        `${block} > passes: passed`,
        `${block} > times out: ${timedOut}`,
        `${block} > runs after the timed-out test: passed`,
      ])

    // Statements that each connection completed, and the errors of the later query of the timed-out tests.
    const recordedLines = {
      // The fixture of the first describe block.
      1: [
        "BEGIN",
        "SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "SELECT 'passes'",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "SELECT set_config('kern.test', 'timed out', true)",
        // The rollback waits for the query of the timed-out test.
        "SELECT pg_sleep(1)",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "SAVEPOINT kern_1",
        "SELECT current_setting('kern.test', true)",
        "ROLLBACK TO SAVEPOINT kern_1",
        "RELEASE SAVEPOINT kern_1",
        "ROLLBACK",
        "release",
      ],
      // The tests of the second describe block, each in a transaction on its own connection.
      2: ["BEGIN", "SELECT 'passes'", "ROLLBACK", "release"],
      3: [
        "BEGIN",
        "SELECT set_config('kern.test', 'timed out', true)",
        "SELECT pg_sleep(1)",
        "ROLLBACK",
        "release",
      ],
      4: ["BEGIN", "SELECT current_setting('kern.test', true)", "ROLLBACK", "release"],
      late: [
        "Cannot execute a query: its transaction is already finished",
        "Cannot execute a query: its transaction is already finished",
      ],
    }

    /** Groups the lines that a process of the scenario recorded by their prefix: the connection of a statement, or `late`. */
    function groupLines(lines: string[]) {
      const groups: Record<string, string[]> = {}
      for (const line of lines) {
        const separator = line.indexOf(": ")
        const group = (groups[line.slice(0, separator)] ??= [])
        group.push(line.slice(separator + 2))
      }
      return groups
    }

    test("node:test with t.signal rolls back a test that times out while its query runs once the query completes", async () => {
      const report = join(consumer, "node-postgres.tap")
      const processes = await runScenario(
        "node-postgres",
        [
          "node",
          "--test",
          "--test-reporter=tap",
          `--test-reporter-destination=${report}`,
          "timeout.mjs",
        ],
        { failing: true },
      )

      expect(readTapOutcomes(await readFile(report, "utf8"))).toEqual(
        getOutcomes("testTimeoutFailure"),
      )
      expect(processes.map(groupLines)).toEqual([recordedLines])
    }, 60_000)

    test("Vitest with the signal of aroundEach rolls back a test that times out while its query runs once the query completes", async () => {
      const report = join(consumer, "vitest-postgres.json")
      const processes = await runScenario(
        "vitest-postgres",
        [
          "node",
          join(consumer, "node_modules/vitest/vitest.mjs"),
          "run",
          "--reporter=json",
          `--outputFile=${report}`,
        ],
        { failing: true },
      )

      expect(readVitestOutcomes(JSON.parse(await readFile(report, "utf8")))).toEqual(
        // The test fails with its timeout, and so does its test transaction, with the reason of the signal.
        getOutcomes("Test timed out in 300ms.; Test timed out in 300ms."),
      )
      expect(processes.map(groupLines)).toEqual([recordedLines])
    }, 60_000)
  })
})

/** Reads the outcome of each test nested in a describe block from the TAP output of node:test, as `<block> > <test>: <outcome>`: `passed` or the type of the failure. */
function readTapOutcomes(tap: string): string[] {
  const outcomes: string[] = []
  let block = ""
  for (const line of tap.split("\n")) {
    const subtest = /^# Subtest: (.+)$/.exec(line)
    const test = /^ {4}(not )?ok \d+ - (.+)$/.exec(line)
    const failure = /^ {6}failureType: '(\w+)'$/.exec(line)
    if (subtest) {
      block = subtest[1]!
    } else if (test) {
      outcomes.push(`${block} > ${test[2]}: ${test[1] ? "failed" : "passed"}`)
    } else if (failure) {
      outcomes.push(outcomes.pop()!.replace(/failed$/, failure[1]!))
    }
  }
  return outcomes
}

/** Reads the outcome of each test from the JSON report of Vitest, as `<blocks> > <test>: <outcome>`: `passed` or the first lines of its errors. */
function readVitestOutcomes(report: {
  testResults: {
    assertionResults: {
      ancestorTitles: string[]
      title: string
      status: string
      failureMessages: string[]
    }[]
  }[]
}): string[] {
  return report.testResults.flatMap(({ assertionResults }) =>
    assertionResults.map(({ ancestorTitles, title, status, failureMessages }) => {
      const outcome =
        status === "passed"
          ? status
          : failureMessages
              .map(message => message.split("\n", 1)[0]!.replace(/^Error: /, ""))
              .join("; ")
      return `${[...ancestorTitles, title].join(" > ")}: ${outcome}`
    }),
  )
}

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

/** Type-checks project `config` of the consumer with `tsc` and returns the reason that each error names, as the property that a type error interface of kern-orm requires, or the first line of an error without one. */
function getTypeErrorReasons(tsc: string[], config: string): string[] {
  const { stdout } = Bun.spawnSync({ cmd: [...tsc, "-p", config], cwd: consumer })
  // An error starts at the start of a line, and its details follow on indented lines.
  return stdout
    .toString()
    .trim()
    .split(/\n(?=\S)/)
    .map(error => /Property '"([^"]+)"' is missing/.exec(error)?.[1] ?? error.split("\n")[0]!)
}

/** Runs a command in `cwd` and returns its standard output, throwing with its standard error on failure. */
function run(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync({ cmd, cwd })
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.toString()
}
