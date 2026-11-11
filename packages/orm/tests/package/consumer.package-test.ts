// Checks the packed packages as consumer projects outside the workspace install them, at the versions that the release of the pending changesets gives them; the `test:package` script builds them first.
// The consumers resolve the packages only from their own node_modules, without the `paths` of the repository and the overrides of its workspace.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, relative } from "node:path"

import { getReleasePlan } from "@changesets/get-release-plan"
import { build } from "esbuild"
import { rolldown } from "rolldown"

import { run, runAsync } from "./run"

const root = join(import.meta.dir, "../../../..")
const fixtures = join(import.meta.dir, "fixtures")

/** Directories of the published packages. */
const packageDirs = ["packages/db", "packages/orm", "packages/migrations"]

/** Fields of a manifest that require other packages. */
const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"] as const

/** Manifest of a packed package. */
interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

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
  statementText: 'DELETE FROM "app"."form" WHERE id = ($1::uuid)',
}

/** Directory of the temporary files of the test: the packed and extracted packages, and the consumer projects. */
let work: string
/** Manifests of the packed packages of the repository by their names, at the versions of the release plan. */
const packed = new Map<string, Manifest>()
/** Packages that the registry of the test serves, by their names: their manifests, their tarballs, and the integrity of the tarballs. */
const served = new Map<string, { manifest: Manifest; tarball: string; integrity: string }>()
/** Registry of npm for the consumers, which serves the packages of `served` and rejects any other package, so that npm installs them without network. */
let registry: ReturnType<typeof Bun.serve>
/** Consumer of `kern-orm`, which does not require `kern-db` itself, and of the migrator. */
let ormConsumer: string
/** Consumer of `kern-db` and of the migrator, without `kern-orm` and without `pg` installed. */
let dbConsumer: string
/** Consumer of `kern-orm` that cannot resolve `kern-db`, which npm installs under `kern-orm`, as a strict layout such as of pnpm does; it emits the declarations of the fixtures that export values. */
let isolatedOrmConsumer: string

/** Returns the directory of a packed package of the repository extracted in `work`. */
function getPackedDir(name: string): string {
  return join(work, "packages", name)
}

/** Returns the modules that the files of `dist/` of the packed package `name` import, also in their declarations. */
async function readPackedImports(name: string): Promise<{ file: string; specifier: string }[]> {
  const dir = join(getPackedDir(name), "dist")
  const imports: { file: string; specifier: string }[] = []
  for (const file of await readdir(dir)) {
    const code = await readFile(join(dir, file), "utf8")
    for (const [, specifier] of code.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      imports.push({ file, specifier: specifier! })
    }
  }
  return imports
}

/** Packs the package of directory `dir` into `work` without running its lifecycle scripts, and returns the path of the tarball. */
function pack(dir: string): string {
  // `changeset publish` publishes with npm, which, unlike Bun, leaves protocols such as `catalog:` as they are.
  const [{ filename }] = JSON.parse(
    run(["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", work], dir),
  ) as [{ filename: string }]
  return join(work, filename)
}

/** Adds the package of `tarball` with `manifest` to the registry of the test. */
async function serve(manifest: Manifest, tarball: string): Promise<void> {
  const hash = new Bun.CryptoHasher("sha512").update(await Bun.file(tarball).bytes())
  served.set(manifest.name, { manifest, tarball, integrity: `sha512-${hash.digest("base64")}` })
}

/**
 * Packs the package of the repository of `dir` with the version that the release plan gives it, extracts it, and serves it.
 *
 * `versions` holds the new versions of the packages that the plan releases.
 */
async function packRelease(dir: string, versions: ReadonlyMap<string, string>) {
  const { name } = (await Bun.file(join(root, dir, "package.json")).json()) as Manifest
  const target = getPackedDir(name)
  await mkdir(target, { recursive: true })
  run(["tar", "-xzf", pack(join(root, dir)), "-C", target, "--strip-components=1"], work)
  // The manifest of the workspace holds the version before the release, such as `0.0.0` of a package that was never released, so the package is packed again with the version of the release.
  const manifestPath = join(target, "package.json")
  const manifest = (await Bun.file(manifestPath).json()) as Manifest
  manifest.version = versions.get(name) ?? manifest.version
  // Ranges of released packages change as `changeset version` writes them with the configuration of the repository.
  // A dependency takes the new version by the same operator; a peer dependency takes it only when its range rejects it, such as `^0.1.0` of `0.2.0`.
  // A range of a protocol, such as `workspace:*`, stays as it is, so that the test rejects it.
  for (const field of dependencyFields) {
    const dependencies = manifest[field] ?? {}
    for (const [dependency, range] of Object.entries(dependencies)) {
      const version = versions.get(dependency)
      if (
        version !== undefined &&
        !range.includes(":") &&
        (field !== "peerDependencies" || !Bun.semver.satisfies(version, range))
      ) {
        dependencies[dependency] = `${/^[~^]?/.exec(range)![0]}${version}`
      }
    }
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  packed.set(name, manifest)
  await serve(manifest, pack(target))
}

/** Starts the registry of the test, which answers the requests of npm for the metadata of a package and for its tarball. */
function startRegistry(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: 0,
    fetch(request): Response {
      const { pathname } = new URL(request.url)
      const tarball = /^\/-\/([^/]+\.tgz)$/.exec(pathname)
      if (tarball !== null) {
        return new Response(Bun.file(join(work, tarball[1]!)))
      }
      const entry = served.get(decodeURIComponent(pathname.slice(1)))
      if (entry === undefined) {
        return Response.json({ error: "Not found" }, { status: 404 })
      }
      const { manifest } = entry
      return Response.json({
        name: manifest.name,
        "dist-tags": { latest: manifest.version },
        versions: {
          [manifest.version]: {
            ...manifest,
            dist: {
              tarball: new URL(`-/${basename(entry.tarball)}`, server.url).href,
              integrity: entry.integrity,
            },
          },
        },
      })
    },
  })
  return server
}

/** Options of a consumer project that differs from the others of its fixtures. */
interface ConsumerOptions {
  /** Name of its directory instead of `<name>-consumer`. */
  dir?: string
  /** Layout of the installed packages: `nested` installs each dependency of a package under it, so that the consumer cannot resolve the dependencies of a package, as in a strict layout such as of pnpm. */
  installStrategy?: "nested"
  /** Fixtures that its `tsconfig.json` includes instead of all of them. */
  include?: string[]
  /**
   * Programs of their own by their names, each of its fixtures in `tsconfig.<name>.json`.
   *
   * TypeScript names a type in a declaration only through a module that the program loads and that exports the type, so a fixture that imports another entry point would hide a type that an entry point does not export.
   */
  programs?: Record<string, string[]>
}

/**
 * Creates the consumer project `name` from the fixtures of `fixtures/<name>` and `fixtures/common`, whose manifest requires the packages of `required` and postgres.js, and installs them with npm from the registry of the test.
 *
 * It then links the development tools of the fixtures, and `linked` packages of the workspace, which the registry does not serve.
 */
async function createConsumer(
  name: string,
  required: string[],
  linked: { path: string; name: string }[],
  options: ConsumerOptions = {},
): Promise<string> {
  const dir = join(work, options.dir ?? `${name}-consumer`)
  await mkdir(dir)
  await cp(join(fixtures, "common"), dir, { recursive: true })
  await cp(join(fixtures, name), dir, { recursive: true })
  const dependencies: Record<string, string> = {
    postgres: `^${served.get("postgres")!.manifest.version}`,
  }
  for (const packageName of required) {
    dependencies[packageName] = `^${packed.get(packageName)!.version}`
  }
  await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module", dependencies }))
  // An empty configuration of the user, and a cache of the test, so that npm reads nothing of the machine.
  await writeFile(join(work, ".npmrc"), "")
  await runAsync(
    [
      "npm",
      "install",
      `--registry=${registry.url.href}`,
      `--userconfig=${join(work, ".npmrc")}`,
      `--cache=${join(work, "npm-cache")}`,
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--install-strategy=${options.installStrategy ?? "hoisted"}`,
    ],
    dir,
    60_000,
  )
  await mkdir(join(dir, "node_modules/@types"), { recursive: true })
  for (const { path, name: packageName } of [
    { path: "node_modules/@types/node", name: "@types/node" },
    { path: "node_modules/@types/bun", name: "@types/bun" },
    { path: "node_modules/vitest", name: "vitest" },
    ...linked,
  ]) {
    await symlink(join(root, path), join(dir, "node_modules", packageName))
  }
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        target: "esnext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        // A fixture imports the modules of the project by their file names, as Node.js requires.
        allowImportingTsExtensions: true,
        outDir: "declarations",
        types: ["node"],
      },
      include: options.include ?? ["*.ts"],
    }),
  )
  await writeFile(
    join(dir, "tsconfig.declarations.json"),
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
  for (const [program, include] of Object.entries(options.programs ?? {})) {
    await writeFile(
      join(dir, `tsconfig.${program}.json`),
      JSON.stringify({ extends: "./tsconfig.json", include }),
    )
  }
  return dir
}

beforeAll(async () => {
  // The real path, which bundlers report the modules of the consumers by.
  work = await realpath(await mkdtemp(join(tmpdir(), "kern-packages-")))
  registry = startRegistry()
  const plan = await getReleasePlan(root)
  const versions = new Map<string, string>()
  for (const release of plan.releases) {
    if (release.type !== "none") {
      versions.set(release.name, release.newVersion)
    }
  }
  for (const dir of packageDirs) {
    await packRelease(dir, versions)
  }
  // postgres.js has no dependencies, so the registry serves it as the workspace installs it.
  const postgresDir = await realpath(join(root, "packages/db/node_modules/postgres"))
  await serve(await Bun.file(join(postgresDir, "package.json")).json(), pack(postgresDir))
  ormConsumer = await createConsumer(
    "orm",
    ["kern-orm", "kern-migrations"],
    // The client of the scenario of node-postgres, whose dependencies the registry does not serve.
    [
      { path: "packages/db/node_modules/pg", name: "pg" },
      { path: "packages/db/node_modules/@types/pg", name: "@types/pg" },
    ],
  )
  dbConsumer = await createConsumer("db", ["kern-db", "kern-migrations"], [], {
    programs: { types: ["types-helper.ts"] },
  })
  isolatedOrmConsumer = await createConsumer("orm", ["kern-orm"], [], {
    dir: "orm-isolated-consumer",
    installStrategy: "nested",
    include: ["helper.ts"],
    programs: {
      root: ["root-helper.ts"],
      types: ["types-helper.ts"],
      "db-types": ["db-types-helper.ts"],
    },
  })
  await writeFile(
    join(ormConsumer, "tsconfig.type-tests.json"),
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
    join(ormConsumer, "tsconfig.primary-key.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        noEmit: true,
        emitDeclarationOnly: false,
      },
      include: ["primary-key/*.ts"],
    }),
  )
  // The weakest options that kern-orm supports, as the install section of docs/orm/getting-started.md states.
  await writeFile(
    join(ormConsumer, "tsconfig.found-key.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        strict: false,
        strictNullChecks: true,
        noEmit: true,
        emitDeclarationOnly: false,
      },
      include: ["found-key/*.ts"],
    }),
  )
  await writeFile(
    join(ormConsumer, "tsconfig.primary-key-without-strict-null-checks.json"),
    JSON.stringify({
      extends: "./tsconfig.primary-key.json",
      compilerOptions: {
        strictNullChecks: false,
      },
    }),
  )
}, 120_000)

afterAll(async () => {
  await registry?.stop(true)
  await rm(work, { recursive: true, force: true })
})

describe("manifests", () => {
  test("publish dependencies without the catalog: and workspace: protocols", () => {
    const protocols: string[] = []
    for (const manifest of packed.values()) {
      for (const field of dependencyFields) {
        for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
          if (/^(catalog|workspace):/.test(range)) {
            protocols.push(`${manifest.name} ${field} ${dependency}: ${range}`)
          }
        }
      }
    }
    expect(protocols).toEqual([])
  })

  test("require the packages of the repository by ranges that their versions of the release plan satisfy", () => {
    const required: string[] = []
    const unsatisfied: string[] = []
    for (const manifest of packed.values()) {
      for (const field of dependencyFields) {
        for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
          const target = packed.get(dependency)
          if (target !== undefined) {
            required.push(`${manifest.name} ${field} ${dependency}`)
            if (!Bun.semver.satisfies(target.version, range)) {
              unsatisfied.push(
                `${manifest.name} ${field} ${dependency}: ${range} rejects ${target.version}`,
              )
            }
          }
        }
      }
    }

    expect(unsatisfied).toEqual([])
    expect(required.toSorted()).toEqual([
      "kern-migrations peerDependencies kern-db",
      "kern-orm dependencies kern-db",
    ])
  })

  test.each(["kern-db", "kern-migrations"])(
    "give %s no dependency on kern-orm, also in its code and declarations",
    async name => {
      const isOrm = (specifier: string) => /^(?:kern-orm|@kern-orm\/[^/]+)(?:\/|$)/.test(specifier)
      const manifest = packed.get(name)!
      const references: string[] = []
      for (const field of dependencyFields) {
        for (const dependency of Object.keys(manifest[field] ?? {})) {
          if (isOrm(dependency)) {
            references.push(`${field} ${dependency}`)
          }
        }
      }
      for (const { file, specifier } of await readPackedImports(name)) {
        if (isOrm(specifier)) {
          references.push(`${file}: ${specifier}`)
        }
      }

      expect(references).toEqual([])
    },
  )
})

describe.each([
  ["pinned", [join(root, "node_modules/.bin/tsc")]],
  // The minimum version that consumers need, as the install sections of the Getting Started pages of the site state.
  ["minimum", ["node", Bun.resolveSync("typescript-6/lib/tsc.js", import.meta.dir)]],
])("TypeScript %s", (_, tsc) => {
  test("emits declarations of a consumer of kern-orm and type-checks their consumer with Node.js module resolution", () => {
    run([...tsc, "-p", ormConsumer], ormConsumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], ormConsumer)
    run([...tsc, "-p", "tsconfig.type-tests.json"], ormConsumer)
  }, 60_000)

  test("emits declarations of a consumer of kern-orm that cannot resolve kern-db, also of a module that imports only the root, and type-checks them", () => {
    // npm installs kern-db only under kern-orm, so the declarations name its types through the entry points of kern-orm.
    expect(existsSync(join(isolatedOrmConsumer, "node_modules/kern-db"))).toBe(false)
    run([...tsc, "-p", isolatedOrmConsumer], isolatedOrmConsumer)
    run([...tsc, "-p", "tsconfig.root.json"], isolatedOrmConsumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], isolatedOrmConsumer)
  }, 60_000)

  test("emits declarations of a module that imports only kern-orm/types, kern-orm/db/types, or kern-db/types, and type-checks them", () => {
    run([...tsc, "-p", "tsconfig.types.json"], isolatedOrmConsumer)
    run([...tsc, "-p", "tsconfig.db-types.json"], isolatedOrmConsumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], isolatedOrmConsumer)
    run([...tsc, "-p", "tsconfig.types.json"], dbConsumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], dbConsumer)
  }, 60_000)

  test("emits declarations of a consumer of kern-db and the migrator without kern-orm and pg and checks them with the declarations of the packages", () => {
    run([...tsc, "-p", dbConsumer], dbConsumer)
    run([...tsc, "-p", "tsconfig.declarations.json"], dbConsumer)
  }, 60_000)

  test("rejects a query of another key in upsert, also of a singleton table, of a consumer with strictNullChecks alone", () => {
    run([...tsc, "-p", "tsconfig.found-key.json"], ormConsumer)
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
  describe("consumer of kern-orm", () => {
    test("runs a consumer that connects with kern-orm/db/postgres-js", () => {
      expect(JSON.parse(run([runtime, "consumer.ts"], ormConsumer))).toEqual(consumerOutput)
    })

    test("runs a query of the ORM and a query of SQL text of its database in one ambient transaction", () => {
      expect(JSON.parse(run([runtime, "transaction.ts"], ormConsumer))).toEqual({
        result: { names: ["Survey"], count: 0 },
        statements: [
          { connection: 1, text: "BEGIN", parameters: [] },
          {
            connection: 1,
            text: 'SELECT "form"."name" AS "name" FROM "form" AS "form"',
            parameters: [],
          },
          { connection: 1, text: "UPDATE form SET name = $1", parameters: ["Poll"] },
          { connection: 1, text: "COMMIT", parameters: [] },
          { connection: 1, text: "release", parameters: [] },
        ],
      })
    })

    test("recognizes the types of kern-db, kern-orm/db, and kern-orm in each other's entry points", () => {
      const formId = "6f1c1f5e-4e8f-4c2a-9a55-9f5a3c4b2d10"
      const output = JSON.parse(run([runtime, "db-types.ts"], ormConsumer))

      expect(output).toEqual({
        sameBuiltInTypes: true,
        ormTypeIsDbType: true,
        ormDbTypeIsDbType: true,
        dbTypeIsOrmDbType: true,
        record: { id: formId, count: 2 },
        value: formId,
        ormRecord: { id: formId, count: 2 },
        parameter: { text: "SELECT ($1::integer)", parameters: ["7"] },
        ormQuery: {
          text: 'SELECT "form"."path" AS "path" FROM "form" AS "form" WHERE "form"."id" = $1',
          parameters: [formId],
        },
        statements: expect.any(Array),
      })
    })

    test("runs a consumer of the node-postgres driver of kern-orm/db/node-postgres, whose errors are those of kern-orm", () => {
      expect(JSON.parse(run([runtime, "node-postgres.ts"], ormConsumer))).toEqual({
        acquireAfterClose: "Cannot acquire a connection: the driver is closed",
        isConnectionError: true,
        queryErrorCode: null,
      })
    })

    test.skipIf(!process.env.DATABASE_URL)(
      "migrates the Db of its schema in one transaction with queries of the ORM in PostgreSQL",
      () => {
        expect(JSON.parse(run([runtime, "migration-transaction.ts"], ormConsumer))).toEqual({
          applied: ["0001_create_form"],
          names: ["Survey"],
          schemaExists: false,
        })
      },
    )
  })

  describe("consumer of kern-db without kern-orm and pg", () => {
    test("runs queries of SQL text in a transaction and creates the driver of postgres.js and the test helpers", () => {
      expect(JSON.parse(run([runtime, "db.ts"], dbConsumer))).toEqual({
        forms: [{ id: 1, tags: ["draft", "poll"] }],
        statements: [
          { connection: 1, text: "BEGIN", parameters: [] },
          {
            connection: 1,
            text: 'SELECT id, tags FROM form WHERE "form"."name" = $1 AND tags @> ($2::text[])',
            parameters: ["Survey", '{"poll"}'],
          },
          { connection: 1, text: "COMMIT", parameters: [] },
          { connection: 1, text: "release", parameters: [] },
        ],
      })
    })

    test("runs a query builder of another author, which compiles nested fragments of kern-db with its own parameters and runs typed queries of SQL text", () => {
      expect(JSON.parse(run([runtime, "builder.ts"], dbConsumer))).toEqual({
        statement: {
          text: 'SELECT "id", "name" FROM "form" WHERE "id" = $1::integer AND (name = $2 OR tags @> ($3::text[]))',
          parameters: ["7", "Survey", '{"poll"}'],
        },
        records: [{ id: 7, name: "Survey" }],
      })
    })

    test.skipIf(!process.env.DATABASE_URL)(
      "runs a query of SQL text in PostgreSQL with kern-db/postgres-js",
      () => {
        expect(JSON.parse(run([runtime, "db-postgres.ts"], dbConsumer))).toEqual({
          sum: 2,
          settings: { tags: ["poll"] },
        })
      },
    )

    test("runs a consumer of the migrator", () => {
      expect(JSON.parse(run([runtime, "migrations.ts"], dbConsumer))).toEqual({
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
      await rm(join(dbConsumer, "cli-migrations"), { recursive: true, force: true })
      await cp(join(fixtures, "db/cli-migrations"), join(dbConsumer, "cli-migrations"), {
        recursive: true,
      })
      const runCli = (...args: string[]) => run([runtime, "migrations-cli.ts", ...args], dbConsumer)

      expect(runCli("new", "create_form")).toBe(
        `Created cli-migrations/0001_create_form.ts\nWrote cli-migrations/index.ts\n${JSON.stringify({ keys: [], loadErrors: [] })}\n`,
      )
      expect(runCli("new", "create_user")).toBe(
        `Created cli-migrations/0002_create_user.ts\nWrote cli-migrations/index.ts\n${JSON.stringify(
          {
            keys: ["0001_create_form"],
            // The template of a new migration fails to load until its blank names are filled in.
            loadErrors: ["Cannot load migration 0001_create_form: Cannot quote an empty name"],
          },
        )}\n`,
      )
      const unknown = Bun.spawnSync({
        cmd: [runtime, "migrations-cli.ts", "unknown"],
        cwd: dbConsumer,
      })
      expect({ exitCode: unknown.exitCode, stderr: unknown.stderr.toString() }).toEqual({
        exitCode: 1,
        stderr: "Unknown command unknown\nRun with --help to list the commands.\n",
      })
    })

    test.skipIf(!process.env.DATABASE_URL)(
      "verifies a history with the migration tests of its directory in PostgreSQL",
      () => {
        expect(JSON.parse(run([runtime, "migrations-testing.ts"], dbConsumer))).toEqual({
          calls: ["assertUp", "assertDown"],
          failure:
            "Rolling back migration 0001_create_form does not restore the structure of the schema (- before the migration, + after its rollback):\n  + column survey.id integer\n  + table survey",
        })
      },
    )
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
    const log = join(dbConsumer, `${name}.log`)
    const cwd = join(dbConsumer, "runners", name)
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
      join(dbConsumer, "node_modules/vitest/vitest.mjs"),
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
      ["node", join(dbConsumer, "node_modules/vitest/vitest.mjs"), "run"],
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
        join(dbConsumer, "runners/node-driver-contract"),
        30_000,
      )
    }, 60_000)

    test("Vitest verifies a history with the migration tests that import.meta.glob finds", () => {
      run(
        ["node", join(dbConsumer, "node_modules/vitest/vitest.mjs"), "run"],
        join(dbConsumer, "runners/vitest-migrations"),
      )
    }, 60_000)

    test("node:test with t.signal rolls back a test that times out while its query runs once the query completes", async () => {
      const report = join(dbConsumer, "node-postgres.tap")
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
      const report = join(dbConsumer, "vitest-postgres.json")
      const processes = await runScenario(
        "vitest-postgres",
        [
          "node",
          join(dbConsumer, "node_modules/vitest/vitest.mjs"),
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

/** Bundles of a fixture of a consumer: the code, and the modules of the files that the bundle includes, relative to the consumer. */
interface Bundle {
  code: string
  modules: string[]
}

const bundlers = {
  async esbuild(consumer: string, entry: string): Promise<Bundle> {
    const result = await build({
      entryPoints: [join(consumer, entry)],
      absWorkingDir: consumer,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["pg", "postgres"],
      metafile: true,
      write: false,
    })
    return { code: result.outputFiles[0]!.text, modules: Object.keys(result.metafile.inputs) }
  },
  async rolldown(consumer: string, entry: string): Promise<Bundle> {
    const bundle = await rolldown({
      input: join(consumer, entry),
      platform: "node",
      external: ["pg", "postgres"],
    })
    const { output } = await bundle.generate({ format: "esm" })
    return {
      code: output[0].code,
      modules: output[0].moduleIds.map(id => relative(consumer, id)),
    }
  },
}

describe.each(Object.keys(bundlers) as (keyof typeof bundlers)[])("%s", bundler => {
  test("drops unused types and execution code of a compile-only consumer of kern-orm", async () => {
    const { code } = await bundlers[bundler](ormConsumer, "compile-only.ts")

    // Markers of the transaction coordinator, of the errors of drivers, and of unused built-in types.
    const markers = [
      "AsyncLocalStorage",
      "kern-db.QueryError",
      "kern-db.ConnectionError",
      "kern-db.TransactionConnectionError",
      "timestamptz",
      "jsonb",
    ]
    expect(markers.filter(marker => code.includes(marker))).toEqual([])
    const file = join(ormConsumer, `compile-only.${bundler}.mjs`)
    await writeFile(file, code)
    expect(JSON.parse(run(["node", file], ormConsumer))).toEqual(compileOnlyOutput)
  })

  test("keeps the execution code a consumer of kern-orm uses", async () => {
    const { code } = await bundlers[bundler](ormConsumer, "consumer.ts")

    expect(code.includes("AsyncLocalStorage")).toBe(true)
  })

  test("bundles a consumer of kern-db with no module but its own and those of kern-db", async () => {
    const { modules } = await bundlers[bundler](dbConsumer, "db.ts")

    expect(
      modules.filter(
        module =>
          !["db.ts", "recording-driver.ts"].includes(module) &&
          !module.startsWith("node_modules/kern-db/"),
      ),
    ).toEqual([])
    expect(modules).toContain("node_modules/kern-db/dist/postgres-js.mjs")
  })
})

/** Type-checks project `config` of the consumer of kern-orm with `tsc` and returns the reason that each error names, as the property that a type error interface of kern-orm requires, or the first line of an error without one. */
function getTypeErrorReasons(tsc: string[], config: string): string[] {
  const { stdout } = Bun.spawnSync({ cmd: [...tsc, "-p", config], cwd: ormConsumer })
  // An error starts at the start of a line, and its details follow on indented lines.
  return stdout
    .toString()
    .trim()
    .split(/\n(?=\S)/)
    .map(error => /Property '"([^"]+)"' is missing/.exec(error)?.[1] ?? error.split("\n")[0]!)
}
