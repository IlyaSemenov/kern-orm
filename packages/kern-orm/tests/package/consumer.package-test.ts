// Checks the packed packages as a consumer project installs them; the `test:package` script builds them first.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { build } from "esbuild"
import { rolldown } from "rolldown"

const root = join(import.meta.dir, "../../../..")
// The companion packages, with the packages of the client that their consumer installs, and the packed packages that it also installs.
// `unpublished` marks a package before its first release, which has no published version to run.
const companionPackages: {
  dir: string
  project: string
  clients: string[]
  dependencies?: string[]
  unpublished?: boolean
}[] = [
  {
    dir: "packages/postgres-js",
    project: ".",
    clients: ["postgres"],
  },
  {
    dir: "packages/postgres-js-v3",
    project: "postgres-js-v3",
    clients: ["postgres"],
  },
  {
    dir: "packages/node-postgres",
    project: ".",
    clients: ["pg", "@types/pg"],
  },
  {
    dir: "packages/migrations",
    project: ".",
    clients: ["postgres"],
    dependencies: ["@kern-orm/postgres-js"],
  },
]

// Each packed package with the consumer project that installs it: the postgres.js 3 driver has a project of its own, whose `postgres` is postgres.js 3.
const packages = [{ dir: "packages/kern-orm", project: "." }, ...companionPackages]

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
  conditionText: 'SELECT "form"."id" AS "id" FROM "app"."form" AS "form" WHERE "form"."name" = $1',
}

let consumer: string

/** Returns the directory of a package installed under an alias in `kern-orm`. */
function resolveAlias(alias: string): string {
  return dirname(Bun.resolveSync(`${alias}/package.json`, import.meta.dir))
}

/** Returns the directory of the oldest `kern-orm` in the range of a companion package, installed under an alias named after its version. */
async function resolveMinimumKernOrm(dir: string): Promise<string> {
  const { peerDependencies } = await Bun.file(join(root, dir, "package.json")).json()
  const range: string = peerDependencies["kern-orm"]
  const minimum = /^>=(\S+) <1$/.exec(range)?.[1]
  if (minimum === undefined) {
    throw new Error(`${dir} must require kern-orm by a range of the whole 0.x series, not ${range}`)
  }
  return resolveAlias(`kern-orm-${minimum}`)
}

/** Returns the project of a companion package in a compatibility scenario. */
function getCompanionProject(scenario: string, dir: string): string {
  return join(consumer, scenario, basename(dir))
}

/** Links a package installed in a workspace package into the node_modules of a project. */
async function linkPackage(dir: string, name: string, project: string): Promise<void> {
  const target = join(project, "node_modules", name)
  await mkdir(dirname(target), { recursive: true })
  await symlink(join(root, dir, "node_modules", name), target)
}

/** Creates the project of a companion package in a compatibility scenario from the given copies of the package and `kern-orm`, with the packages of its client and the packed `dependencies`. */
async function createCompanionProject(
  scenario: string,
  dir: string,
  packagePath: string,
  kernOrmPath: string,
  clients: readonly string[],
  dependencies: readonly string[] = [],
): Promise<void> {
  const { name } = await Bun.file(join(root, dir, "package.json")).json()
  const project = getCompanionProject(scenario, dir)
  await cp(packagePath, join(project, "node_modules", name), { recursive: true })
  await cp(kernOrmPath, join(project, "node_modules/kern-orm"), { recursive: true })
  for (const dependency of dependencies) {
    await cp(
      join(consumer, "node_modules", dependency),
      join(project, "node_modules", dependency),
      {
        recursive: true,
      },
    )
  }
  for (const client of clients) {
    await linkPackage(dir, client, project)
  }
  await cp(join(import.meta.dir, "fixtures/companion-consumers", basename(dir)), project, {
    recursive: true,
  })
  await writeFile(
    join(project, "tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: {
        noEmit: true,
        emitDeclarationOnly: false,
      },
      include: ["*.ts"],
    }),
  )
}

beforeAll(async () => {
  consumer = await mkdtemp(join(tmpdir(), "kern-orm-consumer-"))
  // Assemble node_modules without network: the packed packages, and the dependencies they leave to the consumer.
  for (const { dir, project } of packages) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    // `changeset publish` publishes with npm, which, unlike Bun, leaves protocols such as `catalog:` as they are.
    const [{ filename }] = JSON.parse(
      run(["npm", "pack", "--json", "--pack-destination", consumer], join(root, dir)),
    ) as [{ filename: string }]
    const target = join(consumer, project, "node_modules", name)
    await mkdir(target, { recursive: true })
    run(["tar", "-xzf", filename, "-C", target, "--strip-components=1"], consumer)
  }
  await mkdir(join(consumer, "node_modules/@types"))
  await linkPackage("packages/postgres-js", "postgres", consumer)
  await linkPackage("packages/postgres-js-v3", "postgres", join(consumer, "postgres-js-v3"))
  await linkPackage("packages/node-postgres", "pg", consumer)
  await linkPackage("packages/node-postgres", "@types/pg", consumer)
  await symlink(join(root, "node_modules/@types/node"), join(consumer, "node_modules/@types/node"))
  await symlink(join(root, "node_modules/@types/bun"), join(consumer, "node_modules/@types/bun"))
  await symlink(join(root, "node_modules/vitest"), join(consumer, "node_modules/vitest"))
  for (const { dir, project, clients, dependencies, unpublished } of companionPackages) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    await createCompanionProject(
      "minimum-kern-orm",
      dir,
      join(consumer, project, "node_modules", name),
      await resolveMinimumKernOrm(dir),
      clients,
      dependencies,
    )
    if (!unpublished) {
      await createCompanionProject(
        "published-package",
        dir,
        resolveAlias(`${basename(dir)}-published`),
        join(consumer, "node_modules/kern-orm"),
        clients,
        dependencies,
      )
    }
  }
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
        // The script of the command line imports the list module of its migrations by its file name, as Node.js requires.
        allowImportingTsExtensions: true,
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
  // The project of the postgres.js 3 driver emits its declarations beside its node_modules, so that they resolve `postgres` to postgres.js 3.
  await writeFile(
    join(consumer, "postgres-js-v3/tsconfig.json"),
    JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: {
        outDir: "declarations",
      },
      include: ["*.ts"],
    }),
  )
  await writeFile(
    join(consumer, "postgres-js-v3/tsconfig.declarations.json"),
    JSON.stringify({
      extends: "../tsconfig.declarations.json",
      include: ["declarations/*.d.ts"],
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
  for (const { dir, project } of packages) {
    const { name } = await Bun.file(join(root, dir, "package.json")).json()
    const manifest = await Bun.file(
      join(consumer, project, "node_modules", name, "package.json"),
    ).json()
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
    run([...tsc, "-p", "postgres-js-v3"], consumer)
    run([...tsc, "-p", "postgres-js-v3/tsconfig.declarations.json"], consumer)
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

  test("runs a consumer of the migrator", () => {
    expect(JSON.parse(run([runtime, "migrations.ts"], consumer))).toEqual({
      keys: ["0001_create_form", "0002_drop_form"],
      steps: [{ up: "CREATE TABLE form (id integer)", down: "DROP TABLE form" }],
      loadError: {
        name: "MigrationError",
        key: "0002_drop_form",
        message:
          "Migration 0002_drop_form must export a step or a non-empty array of steps as its default export",
      },
    })
  })

  test("runs the command line of the migrator from a script whose migrations come from the list that new writes", async () => {
    // Each runtime starts from the empty list of the fixtures, as a project creates it before its first migration.
    await rm(join(consumer, "cli-migrations"), { recursive: true, force: true })
    await cp(join(import.meta.dir, "fixtures/cli-migrations"), join(consumer, "cli-migrations"), {
      recursive: true,
    })
    const runCli = (...args: string[]) => run([runtime, "migrations-cli.ts", ...args], consumer)

    expect(runCli("new", "create_form")).toBe(
      `Created cli-migrations/0001_create_form.ts\nWrote cli-migrations/index.ts\n${JSON.stringify({ keys: [], loadErrors: [] })}\n`,
    )
    expect(runCli("new", "create_user")).toBe(
      `Created cli-migrations/0002_create_user.ts\nWrote cli-migrations/index.ts\n${JSON.stringify({
        keys: ["0001_create_form"],
        // The template of a new migration fails to load until its blank names are filled in.
        loadErrors: ["Cannot load migration 0001_create_form: Cannot quote an empty name"],
      })}\n`,
    )
    const unknown = Bun.spawnSync({ cmd: [runtime, "migrations-cli.ts", "unknown"], cwd: consumer })
    expect({ exitCode: unknown.exitCode, stderr: unknown.stderr.toString() }).toEqual({
      exitCode: 1,
      stderr: "Unknown command unknown\nRun with --help to list the commands.\n",
    })
  })

  test.skipIf(!process.env.DATABASE_URL)(
    "verifies a history with the migration tests of its directory in PostgreSQL",
    () => {
      expect(JSON.parse(run([runtime, "migrations-testing.ts"], consumer))).toEqual({
        calls: ["assertUp", "assertDown"],
        failure:
          "Rolling back migration 0001_create_form does not restore the structure of the schema (- before the migration, + after its rollback):\n  + column survey.id integer\n  + table survey",
      })
    },
  )

  test("runs a consumer of the postgres.js 3 driver", () => {
    expect(JSON.parse(run([runtime, "postgres-js-v3/consumer.ts"], consumer))).toEqual({
      acquireAfterClose: "Cannot acquire a connection: the driver is closed",
    })
  })

  test("runs a consumer of the node-postgres driver", () => {
    expect(JSON.parse(run([runtime, "node-postgres.ts"], consumer))).toEqual({
      acquireAfterClose: "Cannot acquire a connection: the driver is closed",
    })
  })
})

describe.each(companionPackages)("$dir", ({ dir, unpublished }) => {
  test("declares the minimum version of kern-orm as the minimum of its range", async () => {
    const { version } = await Bun.file(
      join(await resolveMinimumKernOrm(dir), "package.json"),
    ).json()
    const { peerDependencies } = await Bun.file(join(root, dir, "package.json")).json()
    expect(peerDependencies["kern-orm"]).toBe(`>=${version} <1`)
  })

  // The current companion package with the oldest `kern-orm` in its range, and its oldest published version that must keep working with the current `kern-orm`.
  const scenarios = unpublished ? ["minimum-kern-orm"] : ["minimum-kern-orm", "published-package"]
  describe.each(scenarios)("%s", scenario => {
    test("type-checks a consumer", () => {
      run([join(root, "node_modules/.bin/tsc"), "-p", getCompanionProject(scenario, dir)], consumer)
    }, 60_000)

    describe.each(["node", "bun"])("%s", runtime => {
      test.skipIf(!process.env.DATABASE_URL)("runs statements in PostgreSQL", async () => {
        const project = getCompanionProject(scenario, dir)
        const output = run([runtime, "consumer.ts"], project)
        expect(JSON.parse(output)).toEqual(await Bun.file(join(project, "expected.json")).json())
      })
    })
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

    test("node:test runs the tests of the driver contract", () => {
      run(
        ["node", "--test", "contract.mjs"],
        join(consumer, "runners/node-driver-contract"),
        30_000,
      )
    }, 60_000)

    test("Vitest verifies a history with the migration tests that import.meta.glob finds", () => {
      run(
        ["node", join(consumer, "node_modules/vitest/vitest.mjs"), "run"],
        join(consumer, "runners/vitest-migrations"),
      )
    }, 60_000)

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

/**
 * Runs a command in `cwd` and returns its standard output, throwing with its standard error on failure.
 *
 * `timeout` limits a command that can hang, in milliseconds: `spawnSync` blocks the event loop, so the timeout of the calling test cannot stop it.
 */
function run(cmd: string[], cwd: string, timeout?: number): string {
  const result = Bun.spawnSync({ cmd, cwd, timeout })
  if (result.exitCode !== 0) {
    const outcome = result.exitedDueToTimeout ? "timed out" : "failed"
    throw new Error(`${cmd.join(" ")} ${outcome}:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.toString()
}
