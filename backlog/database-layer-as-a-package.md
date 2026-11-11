# Database layer as a package

The [database layer](../architecture/README.md#layers) as the package `kern-db`, so that the migrator and code without the ORM, such as a runner of jobs, use it without `kern-orm` ([decision](../decisions/packages/database-package.md)).

## Decisions

- One repository, this one, publishes three packages with independent versions, without fixed or linked versioning: `kern-db` in `packages/db`, `kern-orm` in `packages/orm`, and `kern-migrations` in `packages/migrations`.
  A runner of jobs, `kern-jobs`, is a package of its own repository that uses the public API of `kern-db`.
- `kern-db` holds the driver contract and the drivers, `Database` with its ambient transactions, sessions, and advisory locks, SQL fragments and queries of SQL text with the encoding of their parameters, codecs and the decoding of flat results, the test helpers and fixtures, and the errors of drivers and transactions.
- `kern-orm` holds tables, schemas, relations, expressions with their operators, queries and mutations, the AST with its lowering and compiler, the decoding of nested results, and `bindSchema`.
- `kern-migrations` depends only on `kern-db` and imports nothing of `kern-orm`, also in types; it takes a `Db` by its members `$database` and `$schemaName`.
- The drivers are the subpaths `kern-db/postgres-js` and `kern-db/node-postgres`, not packages: `kern-db` requires `postgres`, `pg`, and `@types/pg` by optional peer dependencies, and each subpath is an entry point of its own, so that importing `kern-db` or `kern-db/types` loads no driver and needs no client installed.
- Entry points of `kern-db`: `kern-db`, `kern-db/types` (the codecs of the built-in types), `kern-db/testing`, `kern-db/postgres-js`, and `kern-db/node-postgres`.
- `kern-orm` re-exports the layer from `kern-orm/db`, `kern-orm/db/types`, `kern-orm/db/postgres-js`, and `kern-orm/db/node-postgres`, and from `kern-orm/testing` the test helpers of `kern-db/testing`; `kern-orm/types` keeps the types of the ORM with their operators.
- The root of `kern-orm` exports `createDatabase` and `Database` of the layer, and the errors and the types of options that it exports now; `bindSchema(schema, database, options?)` binds a schema to any `Database` of the layer, which knows no schemas.
- `Database` has no member of its coordinator: `getCoordinator` of the module of `Database` finds it by the object for the test helpers and the driver contract, and no entry point exports it.
- The ORM interpolates a fragment of the layer, also into `sql` and `$query`, and compiles it in its own context of parameters; the layer never interpolates an expression of the ORM.
- A template of the layer takes values without a codec only of `string`, `number`, `bigint`, `boolean`, `null`, `Date`, and `Uint8Array`, and its fragments; JSON and arrays take `param` with a codec.
- The layer takes a [type](../architecture/types.md) of the ORM wherever it takes a codec, such as in `get(t.uuid)`.
- `kern-orm` requires `kern-db` in `dependencies`, and `kern-migrations` in `peerDependencies` and in `devDependencies` as `workspace:*`, each by a range of one minor line, such as `^0.1.0`, under [package compatibility](../architecture/compatibility.md).
- The first versions: `kern-db` 0.1.0 and `kern-migrations` 0.1.0, each from the version `0.0.0` of its new manifest and a `minor` changeset; `kern-orm` continues its versions, to the version that its pending changesets release.

## Steps

1. Done: the contract of codecs and the codecs of the built-in types, exported from `kern-orm/db` and `kern-orm/db/types`, and `Type` built on them.
2. Done: queries of SQL text in the layer, with its SQL fragments and the decoding of flat results, which `query` of a `Database` and `$query` of a `Db` start, and the documentation of migrations on its fragments and codecs.
3. Done: the driver contract and the tests of the layer on its own API, a harness of its tests without the ORM, the check of its imports, the coordinator out of `Database`, and `bindSchema` instead of `bind` of a `Database`.
4. The packages, as the plan below describes.

## Plan of step 4

Implementation:

1. Move `packages/kern-orm` to `packages/orm`, keeping the npm name `kern-orm`, and create `packages/db` for `kern-db` from `packages/kern-orm/src/database/` with its tests, the entry points `src/db.ts`, `src/db/types.ts`, and `src/testing.ts`, the harness `testing/database/`, and the tests of the test runners `tests/runner/` and `tests/test-runner.test.ts`.
   Keep `packages/migrations` and rename its package `@kern-orm/migrations` to `kern-migrations`.
2. Give `kern-db` the entry points `kern-db`, `kern-db/types`, `kern-db/testing`, `kern-db/postgres-js`, and `kern-db/node-postgres` in `package.json` and `tsdown.config.ts`, with the manifest version `0.0.0`.
3. Move the drivers of `packages/postgres-js` and `packages/node-postgres` into `packages/db/src/drivers/`, with their tests, importing the errors of the layer by relative paths, and delete those workspaces.
   The driver contract of `kern-db/testing` runs for both drivers from their tests.
4. Declare `postgres`, `pg`, and `@types/pg` in `peerDependencies` of `kern-db` with `peerDependenciesMeta` optional, and in its `devDependencies` as `"catalog:"`.
5. Declare `kern-db` in `dependencies` of `kern-orm` as `^0.1.0`.
   Check whether Bun links the workspace package for a plain range that its version satisfies; if it does not, declare it so that the workspace links it, such as also in `devDependencies` as `workspace:*`, as long as `changeset publish` publishes the range.
6. Import the layer in `kern-orm` from `kern-db` by name, and re-export it from `kern-orm/db`, `kern-orm/db/types`, `kern-orm/db/postgres-js`, `kern-orm/db/node-postgres`, and `kern-orm/testing`; keep `kern-db` external in `tsdown.config.ts`, so that the build of `kern-orm` bundles no copy of it.
7. Make `kern-migrations` import only types of `kern-db`, declare `kern-db` as `^0.1.0` in `peerDependencies` and as `workspace:*` in `devDependencies`, and drop `kern-orm` from its dependencies.
   Keep the tests of the migrator that take a `Db`, binding it with `kern-orm` from its `devDependencies`.
8. Check structurally, without imports of `kern-orm`, that `MigrationTarget`, `MigrationTargetDb`, and `MigrationDatabase` accept a `Db` of `kern-orm` and a `Database` of `kern-db`.
9. Update `paths` of the root `tsconfig.json`, the include of the Vitest config, the scripts of the root `package.json`, the CI workflow, the paths of `AGENTS.md`, `architecture/`, `decisions/`, and `benchmarks/`, the examples, and the documentation site.
   Replace the check of imports of the layer, `tests/database-layer.test.ts`, by one that `packages/db` imports nothing of `kern-orm`, since `paths` of the root `tsconfig.json` resolves `kern-orm` in every package.
   Keep one harness of PostgreSQL and one recording driver in `packages/db/testing/`, which the tests of `kern-orm` and the migrator import by relative paths, rather than publish them from `kern-db/testing`.
10. Rework the package test for the three packages: pack each of them, and install the tarballs, so that no step needs a release published first.
11. Bring the release metadata in line with the packages:
    - Rename `@kern-orm/migrations` to `kern-migrations` in the pending changesets, and write a changeset of `kern-migrations` that it replaces `@kern-orm/migrations`.
    - Add a `minor` changeset of `kern-db` for its first release, and a changeset of `kern-orm` for its dependency on `kern-db` and the subpaths of the drivers.
    - Release no version of `@kern-orm/postgres-js`, `@kern-orm/node-postgres`, or `@kern-orm/migrations`.
    - Check the versions with `bunx changeset status --verbose`: `kern-db` 0.1.0, `kern-migrations` 0.1.0, and the next minor version of `kern-orm`.

Acceptance tests of the package test, against the packed packages:

- A consumer installs `kern-db` and `postgres` without `kern-orm`, runs a query of SQL text, and migrates with `kern-migrations`.
- A consumer installs `kern-orm` and `postgres` without `kern-db` in its own dependencies, and connects with `kern-orm/db/postgres-js`.
- A consumer of `kern-orm` and `kern-migrations` migrates the `Db` of its schema, whose `$database` is the database that it created, in one transaction with a query of the ORM.
- `kern-db/types`, `Type` of `kern-orm`, and `get`, `select`, and `param` recognize each other's codecs in the packed packages, and no two entry points create codecs of different brands.
- A query of the ORM and a query of SQL text of one `Database` run in one ambient transaction.
- `kern-db` has no runtime or declaration dependency on `kern-orm`.
- The packed packages pass a consumer under TypeScript 6 and the pinned TypeScript, and run on Node.js and Bun.
- A bundled consumer without the ORM includes no code of `kern-orm`.

Release, after step 4:

1. `kern-db` with its subpaths.
2. `kern-orm` with its dependency on the published `kern-db`.
3. `kern-migrations` with its peer range of that `kern-db`.

`npm deprecate` of `@kern-orm/postgres-js`, `@kern-orm/node-postgres`, and `@kern-orm/migrations` points to their replacements once the new packages are published.

The documentation site moves to the groups of its sidebar, which step 3 introduces: its files to `docs/orm/`, `docs/database/`, and `docs/migrations/`, a Getting Started page of each package, a home page with entries of the ORM and the database, and a switch of Stable and Development versions instead of the version of `kern-orm`.

## Open questions

- Whether a release of `kern-orm` that moves to a new minor version of `kern-db` is a patch, as changesets releases a dependent whose range the new version leaves, or a minor, since an application that also imports `kern-db` gets two copies until it updates.
