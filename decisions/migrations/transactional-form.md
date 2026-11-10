# Changes in a transaction beside those outside one

A step with changes outside a transaction keeps `up` and `down`, which a call in a transaction block runs instead, rather than that call rejecting the migration:

```ts
export default defineMigration({
  up: "CREATE INDEX job_run_at_idx ON job (run_at)",
  down: "DROP INDEX job_run_at_idx",
  outsideTransaction: {
    up: async database => {
      // Checks the catalog and runs `CREATE INDEX CONCURRENTLY`.
    },
    down: "DROP INDEX CONCURRENTLY IF EXISTS job_run_at_idx",
  },
})
```

A history then applies wherever the migrator runs in a transaction block: in the transaction that creates a tenant with its schema, in test transactions and the seeds of test fixtures, which a database created with `test: true` requires of every statement, and in `verifyMigrations`, which rolls back.
On the empty tables of a new schema, building an index in a transaction costs little.

The design gives up:

- One form of each change: a step written by hand repeats its change, which helpers build in both forms.
- Checking what production runs: the verification and migration tests run `up` and `down`, and the changes outside a transaction go unchecked.
- A guard against a call in a transaction on a populated table, such as of a tenant at its first request in a transaction of the request: `up` builds the index while it blocks writes to the table, so the documentation requires migrating existing schemas outside a transaction.

## Rejecting a call in a transaction block

A call in a transaction block could reject a pending migration with changes outside a transaction, as `AddIndexConcurrently` of Django rejects in an atomic block, and a migrator of Kysely given a transaction rejects `disableTransactions`.
Each change would have one form, and no call would run the blocking form on a populated table.
A history with such a migration could not apply in a transaction that creates a tenant, nor at all on a database created with `test: true`, so neither the tests of an application nor the verification could apply it.

## Rejecting only on a populated target

A call in a transaction block could run `up` and `down` only on a target that has no applied migrations, such as a new tenant or the schema of the verification, and reject elsewhere.
Tests that migrate a schema step by step in a test transaction, such as with a migration added to a history applied by a fixture, would reject, and a target without applied migrations may still have populated tables, such as one moved from another migrator.
