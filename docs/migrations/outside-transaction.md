# Migrations Outside a Transaction

To index a big table that your application keeps writing to, pass `concurrently` to `createIndex`: it builds the index with `CREATE INDEX CONCURRENTLY`, which does not block writes, outside a transaction, where PostgreSQL requires it.

```ts [src/migrations/0007_index_job_run_at.ts]
import { createIndex, defineMigration } from "kern-migrations"

export default defineMigration(createIndex("job", ["run_at"], { concurrently: true }))
```

Rolling back drops the index with `DROP INDEX CONCURRENTLY`; `dropIndex` takes `concurrently` too.

`migrate` commits the migrations before such a migration, builds the index outside a transaction, and then applies the migrations after it in a transaction of their own.
Export a step that runs outside a transaction, such as this one, as the only step of its migration, and put other changes, such as creating the table that it indexes, in migrations of their own.

When the build fails, such as of a unique index on duplicate values, fix the cause and call `migrate` again: it drops the index that is not valid, which the failed build leaves, and builds it again.

Inside a transaction, such as the one that [creates a tenant](./applying#tenants), a [test transaction](../database/testing), or [`verifyMigrations`](./testing), `migrate` builds the index as without `concurrently`, which is quick on the empty tables of a new schema.
Migrate existing schemas outside a transaction, such as tenants at their first request when your requests run in transactions: inside one, `migrate` builds the index while it blocks writes to the table.

`concurrently` cannot index a partitioned table, which PostgreSQL indexes concurrently only partition by partition: index it with a [step of your own](#your-own-changes-outside-a-transaction).

## Your own changes outside a transaction

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
import type { MigrationDatabase } from "kern-migrations"
import { defineMigration, quoteIdentifier } from "kern-migrations"
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
