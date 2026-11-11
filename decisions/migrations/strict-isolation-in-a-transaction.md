# Rejecting a call in a transaction at a stricter isolation level

In a transaction block at `REPEATABLE READ` or `SERIALIZABLE`, `migrate`, `rollback`, and `redo` reject when their first read finds migrations to run, before they lock the target, with an error of the migrator that tells to run the call outside a transaction or in a transaction at `READ COMMITTED`.
A call that finds nothing to run resolves to none.
The statement of the first read gives the isolation level of the transaction with `current_setting('transaction_isolation')`.

The design gives up migrating in such a transaction when no other process migrates the target, such as creating a tenant in a serializable transaction, or migrating in a test transaction on a database whose transactions default to `SERIALIZABLE`: such a transaction must run at `READ COMMITTED`.

## Running the call from the snapshot

The call could run, and leave a conflict with another process to PostgreSQL, as in any transaction of a stricter level.
Under the lock, it reads the versions from the snapshot of the transaction, taken before the lock, which misses the migrations that another process has applied or rolled back since:

- `migrate` applies them again and fails on the first object that exists, such as with `relation "form" already exists`, rather than with a serialization failure that the application would retry;
- `rollback` rolls back the last migrations that the snapshot shows and leaves applied a migration that another process has applied after them, so the target has a pending migration before an applied one, without an error.

## Detecting a change since the snapshot

The call could run, and reject with a serialization failure only when another process has changed the versions since the snapshot.
The transaction does not see a row inserted after its snapshot, and PostgreSQL reports a serialization failure for one only on a write that conflicts with it, such as `INSERT ... ON CONFLICT DO NOTHING` of its key, and for a row deleted since only on a write of that row.
Detecting a change would take such a write of every key of the history before running, and would still miss a key that the history lacks, such as of a newer version of the application.

## Isolation level of the nested transaction

The call could pass `isolation: "read committed"` to its nested transaction, which kern-db rejects without `SAVEPOINT` in a transaction of another level, rather than check the level itself.
Its error tells that a nested transaction cannot run at `READ COMMITTED` rather than why the call needs that level and how to run it, it reads the level in a statement of its own, and it rejects `READ UNCOMMITTED`, which PostgreSQL runs as `READ COMMITTED`.

## Rejecting every call in such a transaction

The call could reject also when it finds nothing to run, so that whether it rejects does not depend on the state of the target.
Code that migrates a target at its first use, such as a tenant at its first request, would fail in every transaction of a stricter level, also on a target that is up to date, whose read from the snapshot is as valid as every other read of that transaction.
