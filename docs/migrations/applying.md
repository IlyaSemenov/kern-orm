# Applying Migrations

Call `migrate` with your `Db` and the migrations, such as when the application starts or in a deploy script:

```ts
import { migrate } from "kern-migrations"

await migrate(db, migrations)
```

It applies the pending migrations to the PostgreSQL schema of the `Db` in one transaction, unless one of them runs [outside a transaction](./outside-transaction), and resolves to their names.
Pass `count` to apply only the first pending migrations, such as `{ count: 2 }` for the first two.
It creates the schema and its table of migrations when they are missing.
Instances of the application that migrate one schema at once, such as when they start together, apply each migration once.

When a migration fails, `migrate` rolls back the migrations of the call and rejects with a `MigrationError`, which names the migration and its step and keeps the original error in `cause`.
When the call has a migration outside a transaction, the migrations that it has committed before the failure stay applied: call `migrate` again to apply the rest.

Instances of an older version of the application keep migrating during a rolling deploy: `migrate` accepts migrations that a newer version has applied after its own last migration.
Give a migration that you merge from another branch a number after the migrations already applied anywhere: `migrate` rejects a pending migration before an applied one.

## Without a Db

To apply migrations without a `Db`, such as when your application queries the database with another library, pass the `Database`:

```ts
await migrate(database, migrations)
```

The migrations apply to `current_schema()`, the first existing schema of the search path, such as `public`.
To apply them to another schema, pass it as `schemaName`:

```ts
await migrate(database, migrations, { schemaName: "app" })
```

With only a driver, pass the driver: `migrate` runs on a database of its own over it, outside the transactions of your databases, and leaves the driver open.
To apply migrations in a transaction, such as a [test transaction](../database/testing), pass the database of the transaction instead.

## Tenants

With a [PostgreSQL schema per tenant](../orm/multiple-schemas), migrate the `Db` of the tenants: `migrate` applies the migrations to the schema of the current tenant.

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

Run such a transaction at `read committed`, the default of PostgreSQL.
A transaction at `repeatable read` or `serializable` does not see the migrations that another process applies meanwhile, so `migrate` rejects in it when it has migrations to apply.
On a database whose transactions default to another level, pass `isolation: "read committed"` to the transaction.

## Roll back

To undo the last applied migration, call `rollback`:

```ts
import { rollback } from "kern-migrations"

await rollback(db, migrations)
```

Pass `count` to undo several of the last migrations, or `"all"` to undo every migration.

To undo the last applied migration and apply it again, such as after you change it while you write it, call `redo`; it also takes `count`:

```ts
import { redo } from "kern-migrations"

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
import { getMigrationStatus } from "kern-migrations"

const { applied, pending, unknown } = await getMigrationStatus(db, migrations)
```

`unknown` lists the applied migrations that `migrations` lack, such as those of a newer version of the application.
