# A partitioned table indexed by a step of its own

`createIndex` and `dropIndex` with `concurrently` run `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` whatever the table, and PostgreSQL rejects them for a partitioned table and its index before they change anything, so a migration indexes such a table with a step of its own, as the documentation shows.

The helpers learn of a partitioned table only when they run, so the design gives up failing early: `up` and `down`, which index a partitioned table in a transaction, pass the verification and the tests, and the first call outside a transaction fails.

## Indexing each partition

`createIndex` could index a partitioned table as the step of the documentation does: create the index of the table with `ON ONLY`, build the index of each partition concurrently, and attach it.
It would have to name the index of each partition as PostgreSQL names it when `up` indexes the table, from the names of the partition and of the columns, numbering a name that exists, so that both forms build the same indexes, and to handle partitions of partitions and partitions in other schemas.
`dropIndex` would still have to drop the index of a partitioned table without `CONCURRENTLY`, which PostgreSQL rejects for it.

## Building without `CONCURRENTLY`

The change outside a transaction could index a partitioned table with `CREATE INDEX`, which PostgreSQL accepts there.
It would block writes to every partition while it builds, which `concurrently` asks to avoid, without telling it.
