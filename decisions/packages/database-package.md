# The database layer as the package `kern-db`

The database layer becomes the package `kern-db` in the repository of `kern-orm`, which then publishes three packages with independent versions, each in a directory named by its responsibility:

- `kern-db` (`packages/db`): the driver contract and the drivers, `Database` with its ambient transactions, sessions, and advisory locks, SQL fragments and queries of SQL text with their parameters, types and the decoding of flat results, the test helpers, and the errors of drivers and transactions.
- `kern-orm` (`packages/orm`): tables, schemas, relations, expressions with their operators, queries and mutations, the AST with its lowering and compiler, the decoding of nested results, and `bindSchema`.
- `kern-migrations` (`packages/migrations`): the migrator, which uses only `kern-db`, also in types.

A runner of jobs, a package of its own repository, uses `kern-db` as any application does.

The packages depend on each other as follows:

```jsonc
// kern-orm
{ "dependencies": { "kern-db": "^0.1.0" } }

// kern-migrations
{ "peerDependencies": { "kern-db": "^0.1.0" }, "devDependencies": { "kern-db": "workspace:*" } }
```

An application of the ORM installs `kern-orm` and a client, and imports the layer through the entry points of `kern-orm` that re-export it:

```ts
import { bindSchema, createDatabase } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"

const db = bindSchema(schema, createDatabase({ driver: postgresJsDriver(postgres(url)) }))
```

## A package with subpaths

`kern-orm` could hold the layer and export it from entry points of its own, such as `kern-orm/db`.
One version and no ranges between the packages would keep every combination tested.
Code without the ORM, such as the migrator and a runner of jobs, would then install the ORM, and its releases would follow every release of the ORM; the boundary of the layer would hold only by a check of imports.

## A repository of each package

Each package could have its own repository, with its own CI and history.
Every change across the boundary of the layer, such as the steps that separated it, would then need changes and releases of several repositories in order, and a pair of versions could be tested together only after one of them is published.
One repository tests every pair of the workspace before a release and shares the harness of the tests.

## Packages of the drivers

Each driver could stay a package of its own, such as `@kern-orm/postgres-js`, with a version of its own.
A driver implements the contract of `kern-db` and uses its errors, so it changes with `kern-db` anyway, and each package would add a release and a range to keep in step.
`kern-db` gives each driver a subpath, such as `kern-db/postgres-js`, and requires its client by an optional peer dependency; importing `kern-db` loads no driver.
Supporting two major versions of a client at once would take a subpath of each, decided when a client needs it.
Drizzle ORM gives its drivers subpaths of `drizzle-orm` with optional peer dependencies too.

## An internal entry point of the builder API

`kern-orm` compiles its statements and decodes their results with the rules of the layer, such as how a fragment renders, how a parameter encodes, and how a query of one row takes its row.
`kern-db/builder` exports them as a public entry point, so that the ORM uses the layer only as a query builder of another author can:

```ts
import { renderFragment, startSqlQuery } from "kern-db/builder"
```

An entry point for `kern-orm` alone, such as `kern-db/internal`, would keep these functions out of the public API, which users learn and whose changes a release of `kern-db` describes.
The ORM would then use the layer in ways that another query builder cannot, and nothing would show that the public API of `kern-db` is enough for one.
Nor could they change freely: `kern-orm` accepts every patch of the minor line of `kern-db` that it requires, so a change that breaks it needs a new minor version of `kern-db` either way.

## A peer dependency of `kern-orm`

`kern-orm` could require `kern-db` as a peer dependency, so that an application chooses its one copy.
The ORM does not work without the layer, so every application would install and update both packages for the common case of the ORM alone.
A regular dependency installs `kern-db` with `kern-orm`, and a package manager shares one copy with an application that requires a version in the same range.

The migrator takes the database of the application, so it requires `kern-db` as a peer dependency, and its database is the one that the application created.

A peer dependency does not ensure one copy: an application that requires another minor version of `kern-db` gets two.
Values that a module of one copy brands, such as types and SQL fragments, are not values of another copy, and only the errors of drivers and transactions recognize another copy, by their brands of `Symbol.for`.
kern-orm supports installations of compatible versions and does not make every branded value work across copies.

## A range of the whole 0.x series

A dependent could require `kern-db` by a range of the whole 0.x series, such as `>=0.1.0 <1`, so that a new minor version of `kern-db` releases no dependent.
Every published version of a dependent would then accept every later minor version of `kern-db`, so each change of the contract of `kern-db` would need to keep the published dependents working, such as by deprecated aliases, or to deprecate them.
Before 1.0, a new minor version of `kern-db` may break its contract, and the project has no users whose versions such a contract would protect.

A range of one minor line, such as `^0.1.0`, rejects `0.2.0`: a new minor version of `kern-db` is out of the range of each dependent, which changesets then releases with a patch and the new range, and a dependent that changes for it adds a changeset of its own.
A range may widen once a pair of versions is tested together and the contract of the layer settles.
