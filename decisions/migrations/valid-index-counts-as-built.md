# A valid index of the name counts as built

Outside a transaction, `createIndex` with `concurrently` does nothing when the table has a valid index of its name, drops an index of its name that is not valid, which a failed build leaves, and then builds the index:

```ts
export default defineMigration(createIndex("job", ["run_at"], { concurrently: true }))
```

A valid index of the name is what an attempt has built when the record of its migration then failed to change, such as when the connection broke, so the next `migrate` finds the migration pending and completes it without building the index again.

The design gives up telling that index apart from another index of the name on the table, such as one created by hand with another definition, which counts as built, while `up` in a transaction fails on it.
An index of the name that another migration of the history builds fails `up` in the verification, which runs in a transaction.

## Failing on a valid index of the name

Building could fail on a valid index of its name, still dropping one that is not valid; `AddIndexConcurrently` of Django and Drizzle Kit fail on any index of the name.
After a lost record, the next `migrate` would fail on the index that the attempt built, and someone would have to drop the index, to be built again, or record the migration by hand.

## `IF NOT EXISTS`

Building could add `IF NOT EXISTS`, as `createIndex` of node-pg-migrate with `ifNotExists` and `add_index` of Rails with `if_not_exists: true` do.
It keeps an index that a failed build has left not valid, so the migration is recorded without a usable index ([rails#52583](https://github.com/rails/rails/issues/52583)), and PostgreSQL sends a notice of the existing index.

## Dropping before every build

Building could run `DROP INDEX CONCURRENTLY IF EXISTS` before every build, as the documentation of Kysely 0.30.0-beta.2 does.
After a lost record, it would drop the valid index and build it again, which on a big table takes as long as the first build, and PostgreSQL sends a notice of the missing index at every first build.

## Comparing the definition

Building could count a valid index of its name as built only when `pg_get_indexdef` gives the definition of the step.
PostgreSQL deparses a definition rather than keeping its text, such as with `USING btree`, quotes, and casts, so the migrator would need the definition that PostgreSQL gives the arguments of the step, which only building an index gives, such as in a transaction that rolls back.
