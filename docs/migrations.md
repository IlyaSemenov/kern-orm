# Migrations

Write each change of your database, such as a new table or column, as a migration of steps that helpers, such as `createTable`, build together with the SQL that undoes them.
Call `migrate`, such as when your application starts, to bring the database up to date: it applies the new migrations and remembers which ones it has applied.

Install `@kern-orm/migrations`:

::: code-group

```sh [npm]
npm install @kern-orm/migrations
```

```sh [pnpm]
pnpm add @kern-orm/migrations
```

```sh [bun]
bun add @kern-orm/migrations
```

:::

## Write a migration

Put each migration in its own module and export its steps with `defineMigration`, building them with helpers:

```ts [src/migrations/0001_create_form.ts]
import { createIndex, createTable, defineMigration } from "@kern-orm/migrations"

export default defineMigration([
  createTable("form", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
    name: "text NOT NULL",
    published: "boolean NOT NULL",
  }),
  createIndex("form", ["name"]),
])
```

The steps apply in order, and rolling back the migration undoes them in reverse order.

Name each module `<number>_<name>`, such as `0001_create_form.ts`, with a number of its own: the numbers order the migrations.
[`new`](#create-a-migration) of the command line creates the module with the next number.

Write names without a PostgreSQL schema, such as `form` rather than `app.form`: migrations run with the search path of the schema they apply to, so the same migrations apply to any schema.

Do not import the tables, custom types, or database of your application into a migration: a migration must do the same on every database and in every later version of the application.

## Helpers

Pass the names of tables, columns, indexes, and constraints without quotes: helpers quote them.
Pass definitions, conditions, defaults, and the columns of an index as SQL, quoting a name in them where SQL needs it, such as `'"order"'`.
When you build SQL text from values of your code, quote names with `quoteIdentifier` and strings with `quoteLiteral`, both from `@kern-orm/migrations`.

- Tables: `createTable(table, columns, { constraints })`, `dropTable` with the same arguments, and `renameTable(from, to)`.
- Columns: `addColumn(table, column, definition)`, `dropColumn` with the same arguments, `renameColumn(table, from, to)`, and `changeColumn(table, column, from, to)`.
- Indexes: `createIndex(table, columns, options)` and `dropIndex` with the same arguments; the options are `name`, `unique`, `nullsNotDistinct`, `using`, `include`, `where`, and [`concurrently`](#migrations-outside-a-transaction).
- Constraints: `addConstraint(table, name, definition)`, `dropConstraint` with the same arguments, and `changeConstraint(table, name, from, to)`.
- Extensions: `createExtension(name, { schema })`.

For a change that no helper covers, write a [step of SQL](#sql-steps), or [a helper of your own](./migration-helpers) to reuse it in several migrations.

### Change a column

Pass `changeColumn` the column before and after the change: the `type`, `notNull`, and `default` that change, each in both states, with `default: null` for no default.
When the type of a column with a default changes, give `default` in both states even when it stays the same, so that the default is set again for the new type.
To convert the values to a new type, give the state its `using` expression:

```ts
changeColumn(
  "form",
  "position",
  { type: "text", using: "position::text", default: "''" },
  { type: "integer", using: "position::integer", default: "0" },
)
```

Applying converts the values with `using` of the second state, and rolling back with that of the first.

### Drop a table, column, index, or constraint

Pass a drop helper the definition of what it drops: rolling back creates it again from the definition.

Dropping a table or a column also drops its indexes and constraints.
To restore those that the definition does not describe, drop them with their own steps before it:

```ts
export default defineMigration([
  dropIndex("form", ["slug"], { unique: true }),
  dropColumn("form", "slug", "text"),
])
```

Rolling back does not restore the values of a dropped column, so it fails for a column with `NOT NULL` and without a default when the table has rows.
To drop such a column, give it a default first: rolling back adds the column with the default, which fills the rows, and then drops the default:

```ts
export default defineMigration([
  changeColumn("form", "slug", { default: null }, { default: "''" }),
  dropColumn("form", "slug", "text NOT NULL DEFAULT ''"),
])
```

Describe each constraint once: in the definition, or by a step of its own.
An index of a `PRIMARY KEY` or `UNIQUE` constraint goes with its constraint.

### Index names

`createIndex` names an index as PostgreSQL names an index without a name, such as `form_name_idx`, and `dropIndex` with the same arguments finds it.
Pass `name` for an index of expressions, such as `["lower(email)"]`.

### Extensions

`createExtension` creates an extension unless the database has it, and rolling back keeps it, since other schemas may use it.
Create the extension in a schema of its own and list that schema in `searchPath` of the migrations, so that the migrations find it whatever schema they apply to, such as the schema of each [tenant](./multiple-schemas) or the schema where [`verifyMigrations`](#test-migrations) checks them:

```ts
createExtension("pg_trgm", { schema: "extensions" })
```

It creates the schema too when the database lacks it, and rolling back keeps the schema with the extension.

## SQL steps

For a change that no helper covers, such as filling a new column, write a step of SQL: `up` applies the change, and `down` undoes it.
Put it among the helpers of a migration:

```ts [src/migrations/0003_add_form_slug.ts]
import { addColumn, changeColumn, createIndex, defineMigration } from "@kern-orm/migrations"

export default defineMigration([
  addColumn("form", "slug", "text"),
  { up: "UPDATE form SET slug = regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')" },
  changeColumn("form", "slug", { notNull: false }, { notNull: true }),
  createIndex("form", ["slug"], { unique: true }),
])
```

Leave out `down` of a step that cannot be undone, such as a change of data: rolling back skips it.

A migration of a single step, such as a view, can export the step without an array:

```ts
export default defineMigration({
  up: "CREATE VIEW published_form AS SELECT * FROM form WHERE published",
  down: "DROP VIEW published_form",
})
```

### Code in a migration

When a step needs code, such as to compute values from existing rows, pass a function instead of SQL.
It receives the database of the migration, whose `query`, `script`, and `execute` run in the transaction of the migration:

```ts
import { addColumn, changeColumn, defineMigration } from "@kern-orm/migrations"
import * as t from "kern-orm/db/types"

const toSlug = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")

export default defineMigration([
  addColumn("form", "slug", "text"),
  {
    up: async database => {
      const forms = await database.query`SELECT id, name FROM form`.select({
        id: t.uuid,
        name: t.text,
      })
      for (const form of forms) {
        await database.query`UPDATE form SET slug = ${toSlug(form.name)} WHERE id = ${form.id}`
      }
    },
  },
  changeColumn("form", "slug", { notNull: false }, { notNull: true }),
])
```

To decode the rows of `query`, pass the types of `kern-orm/db/types` to `select`, `get`, and `pluck`.
To name a table or a column known only at runtime in `query`, such as in a loop over tables, interpolate its name with [`identifier`](./database-sql) from `kern-orm/db`.

## Migrations outside a transaction

To index a big table that your application keeps writing to, pass `concurrently` to `createIndex`: it builds the index with `CREATE INDEX CONCURRENTLY`, which does not block writes, outside a transaction, where PostgreSQL requires it.

```ts [src/migrations/0007_index_job_run_at.ts]
import { createIndex, defineMigration } from "@kern-orm/migrations"

export default defineMigration(createIndex("job", ["run_at"], { concurrently: true }))
```

Rolling back drops the index with `DROP INDEX CONCURRENTLY`; `dropIndex` takes `concurrently` too.

`migrate` commits the migrations before such a migration, builds the index outside a transaction, and then applies the migrations after it in a transaction of their own.
Export a step that runs outside a transaction, such as this one, as the only step of its migration, and put other changes, such as creating the table that it indexes, in migrations of their own.

When the build fails, such as of a unique index on duplicate values, fix the cause and call `migrate` again: it drops the index that is not valid, which the failed build leaves, and builds it again.

Inside a transaction, such as the one that [creates a tenant](#tenants), a [test transaction](./testing), or [`verifyMigrations`](#test-migrations), `migrate` builds the index as without `concurrently`, which is quick on the empty tables of a new schema.
Migrate existing schemas outside a transaction, such as tenants at their first request when your requests run in transactions: inside one, `migrate` builds the index while it blocks writes to the table.

`concurrently` cannot index a partitioned table, which PostgreSQL indexes concurrently only partition by partition: index it with a [step of your own](#your-own-changes-outside-a-transaction).

### Your own changes outside a transaction

For another change that PostgreSQL rejects in a transaction, give a step `outsideTransaction` with the changes to run there instead of `up` and `down`.
Rolling back runs `outsideTransaction.down` the same way; a step without it rolls back with `down` in a transaction.

Keep `up` and `down` of the step, and make them build the same objects, with the same names, as the changes outside a transaction: `migrate` runs them inside a transaction.

Send each statement that PostgreSQL rejects in a transaction in a call of its own: PostgreSQL runs a script of several statements in one transaction.

Write the changes so that they can run again: when a change fails, or when the connection breaks after it succeeds and before the migration is recorded, the next `migrate`, or `rollback` for `outsideTransaction.down`, runs it again.
Check what an earlier attempt left: a failed `CREATE INDEX CONCURRENTLY` leaves an index that is not valid, which `IF NOT EXISTS` would keep.

::: details Example: an index of a partitioned table

PostgreSQL builds an index of a partitioned table concurrently only partition by partition: create the index of the table with `ON ONLY`, build the index of each partition concurrently, and attach it to the index of the table.
One function does it for both forms, with `CONCURRENTLY` outside a transaction and without it in one, so that both build the same indexes, and checks the catalog for what an earlier attempt left of each partition.
The step has no `outsideTransaction.down`, since PostgreSQL cannot drop the index of a partitioned table concurrently.

```ts
import type { MigrationDatabase } from "@kern-orm/migrations"
import { defineMigration, quoteIdentifier } from "@kern-orm/migrations"
import * as t from "kern-orm/db/types"

const indexJob = (concurrently: boolean) => async (database: MigrationDatabase) => {
  const mode = concurrently ? "CONCURRENTLY " : ""
  await database.script("CREATE INDEX IF NOT EXISTS job_run_at_idx ON ONLY job (run_at)")
  // The partitions with what an earlier attempt left of their indexes.
  const partitions = await database.query`
    SELECT
      namespace.nspname::text AS schema,
      partition.relname::text AS table,
      naming.index::text AS index,
      index.indisvalid AS valid,
      attached.inhrelid IS NOT NULL AS attached
    FROM pg_inherits AS inheritance
    JOIN pg_class AS partition ON partition.oid = inheritance.inhrelid
    JOIN pg_namespace AS namespace ON namespace.oid = partition.relnamespace
    -- The cast to name truncates the name to 63 bytes, as PostgreSQL does.
    CROSS JOIN LATERAL (SELECT (partition.relname || '_run_at_idx')::name AS index) AS naming
    LEFT JOIN pg_class AS index_class
      ON index_class.relnamespace = partition.relnamespace AND index_class.relname = naming.index
    LEFT JOIN pg_index AS index
      ON index.indexrelid = index_class.oid AND index.indrelid = partition.oid
    LEFT JOIN pg_inherits AS attached ON attached.inhrelid = index.indexrelid
    WHERE inheritance.inhparent = 'job'::regclass
  `.select({
    schema: t.text,
    table: t.text,
    index: t.text,
    valid: t.boolean.nullable(),
    attached: t.boolean,
  })
  for (const partition of partitions) {
    // A partition may be in another schema, where PostgreSQL creates its index.
    const schema = quoteIdentifier(partition.schema)
    const index = `${schema}.${quoteIdentifier(partition.index)}`
    if (partition.valid === false) {
      await database.script(`DROP INDEX ${mode}${index}`)
    }
    if (partition.valid !== true) {
      await database.script(
        `CREATE INDEX ${mode}${quoteIdentifier(partition.index)} ON ${schema}.${quoteIdentifier(partition.table)} (run_at)`,
      )
    }
    if (!partition.attached) {
      await database.script(`ALTER INDEX job_run_at_idx ATTACH PARTITION ${index}`)
    }
  }
}

export default defineMigration({
  up: indexJob(false),
  down: "DROP INDEX job_run_at_idx",
  outsideTransaction: { up: indexJob(true) },
})
```

:::

## List the migrations

Pass the migration modules to `defineMigrations`.
With a bundler that supports `import.meta.glob`, such as Vite, pass its result:

```ts [src/migrations.ts]
import { defineMigrations } from "@kern-orm/migrations"

export const migrations = defineMigrations(
  import.meta.glob(["./migrations/*.ts", "!./migrations/*.migration-test.ts"]),
)
```

The second pattern leaves out the files of [migration tests](#check-how-a-migration-changes-data).

On Node.js and Bun, which lack `import.meta.glob`, let [`new`](#create-a-migration) of the command line write the list of the modules, and pass it to `defineMigrations`:

```ts [src/migrations.ts]
import { defineMigrations } from "@kern-orm/migrations"

import list from "./migrations/index.ts"

export const migrations = defineMigrations(list)
```

Or list the modules by name:

```ts [src/migrations.ts]
import { defineMigrations } from "@kern-orm/migrations"

export const migrations = defineMigrations({
  "0001_create_form": () => import("./migrations/0001_create_form.ts"),
  "0002_create_form_field": () => import("./migrations/0002_create_form_field.ts"),
})
```

A module loads only when its migration applies or rolls back.

When migrations use objects of other PostgreSQL schemas without naming the schema, such as functions of extensions installed in schema `extensions`, list those schemas in `searchPath`:

```ts
export const migrations = defineMigrations(
  import.meta.glob(["./migrations/*.ts", "!./migrations/*.migration-test.ts"]),
  { searchPath: ["extensions"] },
)
```

Each schema keeps its applied migrations in table `kern_migration`; to name the table otherwise, pass `tableName`.

## Apply migrations

Call `migrate` with your `Db` and the migrations, such as when the application starts or in a deploy script:

```ts
import { migrate } from "@kern-orm/migrations"

await migrate(db, migrations)
```

It applies the pending migrations to the PostgreSQL schema of the `Db` in one transaction, unless one of them runs [outside a transaction](#migrations-outside-a-transaction), and resolves to their names.
Pass `count` to apply only the first pending migrations, such as `{ count: 2 }` for the first two.
It creates the schema and its table of migrations when they are missing.
Instances of the application that migrate one schema at once, such as when they start together, apply each migration once.

When a migration fails, `migrate` rolls back the migrations of the call and rejects with a `MigrationError`, which names the migration and its step and keeps the original error in `cause`.
When the call has a migration outside a transaction, the migrations that it has committed before the failure stay applied: call `migrate` again to apply the rest.

Instances of an older version of the application keep migrating during a rolling deploy: `migrate` accepts migrations that a newer version has applied after its own last migration.
Give a migration that you merge from another branch a number after the migrations already applied anywhere: `migrate` rejects a pending migration before an applied one.

To apply migrations without a `Db`, such as when your application queries the database with another library, pass the `Database`:

```ts
await migrate(database, migrations)
```

The migrations apply to `current_schema()`, the first existing schema of the search path, such as `public`.
To apply them to another schema, pass it as `schemaName`:

```ts
await migrate(database, migrations, { schemaName: "app" })
```

## Tenants

With a [PostgreSQL schema per tenant](./multiple-schemas), migrate the `Db` of the tenants: `migrate` applies the migrations to the schema of the current tenant.

```ts
await migrate(tenantDb, tenantMigrations)
```

Migrating a tenant whose schema is up to date costs two light statements, so you can migrate each tenant at its first request in each process.

To create a tenant, pass its schema as `schemaName` in the transaction that creates it, so that its migrations commit or roll back with it:

```ts
await saasDb.$transaction(async () => {
  await saasDb.tenant.insert({ id: tenantId, subdomain: "acme" })
  await migrate(tenantDb, tenantMigrations, { schemaName: "tenant_acme" })
})
```

## Roll back

To undo the last applied migration, call `rollback`:

```ts
import { rollback } from "@kern-orm/migrations"

await rollback(db, migrations)
```

Pass `count` to undo several of the last migrations, or `"all"` to undo every migration.

To undo the last applied migration and apply it again, such as after you change it while you write it, call `redo`; it also takes `count`:

```ts
import { redo } from "@kern-orm/migrations"

await redo(db, migrations)
```

Both reject when the schema has a migration that `migrations` lack, since they cannot undo it.

When `rollback` or `redo` with a migration outside a transaction fails, what it has committed before the failure stays, and calling it again starts from the migrations applied then.
Read the migrations recorded as applied with [`getMigrationStatus`](#status), and complete the call from them:

- Roll back again with `rollback` a migration that the call was rolling back and that is still recorded as applied, since its failed rollback may have dropped part of it.
- Then roll back the rest, or apply the pending migrations with `migrate`.

## Status

To see which migrations a schema has applied, call `getMigrationStatus`:

```ts
import { getMigrationStatus } from "@kern-orm/migrations"

const { applied, pending, unknown } = await getMigrationStatus(db, migrations)
```

`unknown` lists the applied migrations that `migrations` lack, such as those of a newer version of the application.

## Command line

To apply, roll back, and create migrations from your terminal, write a script that runs the command line on your `Db` with your migrations:

```ts [src/migrations-cli.ts]
import { runMigrationCli } from "@kern-orm/migrations/cli"

import { db } from "./db.ts"
import { migrations } from "./migrations.ts"

await runMigrationCli(db, migrations, {
  directory: new URL("./migrations/", import.meta.url),
})
await db.$database.close()
```

Add it to the scripts of `package.json`, such as `"db": "node src/migrations-cli.ts"`, and run its commands:

```sh
npm run db migrate
npm run db rollback
npm run db status
npm run db new add_form_slug
```

- `migrate` applies the pending migrations; `migrate 2` applies the first two of them.
- `rollback` rolls back the last applied migration; `rollback 2` rolls back the last two, and `rollback all` every migration.
- `redo` rolls back the last applied migration and applies it again; `redo 2` does it for the last two.
- `status` lists the applied and the pending migrations.
- `new <name>` creates the module of the next migration.

When a command fails, `runMigrationCli` prints the error and sets the exit code of the process to 1 instead of rejecting, so the script closes the database after it in any case.

With a [PostgreSQL schema per tenant](./multiple-schemas), pass the schema of the tenant with `--schema`, since the command line has no current tenant:

```sh
npm run db -- migrate --schema tenant_acme
```

For the migrations of another `Db`, such as of the SaaS schema, write a script of its own.

### Create a migration

`new` creates the module of the next migration in `directory`, such as `src/migrations/0003_add_form_slug.ts`, with a step whose names are blank:

```ts [src/migrations/0003_add_form_slug.ts]
import { addColumn, defineMigration } from "@kern-orm/migrations"

export default defineMigration([addColumn(/* table */ "", /* column */ "", "text")])
```

For the first migration of the directory, the step is `createTable`.
Fill in the names, or replace the step with the steps of your migration; until then, the migration fails to apply.

To create migrations from a template of your own, such as one that imports your helpers, pass `template`, which takes the name of the module, such as `0003_add_form_slug`, and returns its text.

On Node.js and Bun, which lack `import.meta.glob`, pass `listModule`: `new` writes there the [list of the migration modules](#list-the-migrations) of the directory.

```ts
await runMigrationCli(db, migrations, {
  directory: new URL("./migrations/", import.meta.url),
  listModule: new URL("./migrations/index.ts", import.meta.url),
})
```

Create the list once, before your first migration, with the line by which `new` recognizes a list that it writes:

```ts [src/migrations/index.ts]
// Written by the new command of @kern-orm/migrations
export default {}
```

To let `new` write a list that you have written by hand, add that line at its top.

The list imports each module by its file name, such as `./0001_create_form.ts`.
To import the modules without the extension, as a bundler resolves them, pass `listModule: { path, extensions: false }`.

## Test migrations

To check that every migration applies and rolls back, call `verifyMigrations` with your `Db` and the migrations in a test:

```ts [src/migrations.test.ts]
import { test } from "bun:test"

import { verifyMigrations } from "@kern-orm/migrations/testing"

import { testTransaction } from "../test/helpers.ts"
import { db } from "./db.ts"
import { migrations } from "./migrations.ts"

test(
  "migrations",
  () =>
    testTransaction(() =>
      verifyMigrations(db, migrations, {
        tests: new URL("./migrations/", import.meta.url),
      }),
    ),
  60_000,
)
```

`verifyMigrations` applies the migrations one by one to an empty schema of its own.
It rolls back each migration, checks that the structure of the schema is the same as before the migration, such as that no index or `NOT NULL` of the migration is left, and applies the migration again.
It runs `up` and `down` of a step with [`outsideTransaction`](#migrations-outside-a-transaction), so test the changes outside a transaction on a database of your own.
`tests` is the directory of your [migration tests](#check-how-a-migration-changes-data).

It rolls back all its changes.
Call it in a [test transaction](./testing), as any query of a database created with `test: true`.
Give the test a longer timeout: verifying a long history takes seconds.

With Vitest, pass the migration tests that `import.meta.glob` finds:

```ts
test(
  "migrations",
  () =>
    verifyMigrations(db, migrations, {
      tests: import.meta.glob("./migrations/*.migration-test.ts"),
    }),
  60_000,
)
```

Since the migrations apply to another schema, create extensions in a schema of their own, as [Extensions](#extensions) describes, even when your application has one schema.

### Check how a migration changes data

To check how a migration changes existing rows, write a migration test beside it, in a file named after the migration, such as `0003_add_form_slug.migration-test.ts`:

```ts [src/migrations/0003_add_form_slug.migration-test.ts]
import { expect } from "bun:test"

import { defineMigrationTest } from "@kern-orm/migrations/testing"
import * as t from "kern-orm/db/types"

export default defineMigrationTest("fills slugs from names", {
  setup: async database => {
    await database.query`INSERT INTO form (name, published) VALUES ('Customer Survey', false)`
  },
  assertUp: async database => {
    expect(await database.query`SELECT slug FROM form`.pluck(t.text)).toEqual(["customer-survey"])
  },
})
```

`setup` adds rows to the schema before the migration, and `assertUp` checks them after the migration applies.
To check them after the migration rolls back, pass `assertDown`; then the migration applies again.
Each callback receives the database of the migration, so write table names without a schema, as in migrations.
Each test starts from the schema before its migration, without the rows of other tests.

Do not import the tables of your application into a migration test: they describe the latest schema rather than the schema of the migration.

To check that a migration refuses some rows, such as a migration that adds a unique index, pass `assertUpError` instead of `assertUp` and `assertDown`.
The test fails unless the migration fails to apply, and `assertUpError` receives its `MigrationError`, with the error of PostgreSQL in `cause`:

```ts
export default defineMigrationTest("refuses forms whose slugs collide", {
  setup: async database => {
    await database.query`INSERT INTO form (name, published) VALUES ('Survey', false), ('SURVEY', false)`
  },
  assertUpError: error => {
    expect(error.message).toContain("could not create unique index")
  },
})
```

To write several tests of a migration, export an array of them, or write them in several files, such as `0003_add_form_slug.edge-cases.migration-test.ts`.

When you list the migrations with `import.meta.glob`, exclude their tests, as [List the migrations](#list-the-migrations) shows.
