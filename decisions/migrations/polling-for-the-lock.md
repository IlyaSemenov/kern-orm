# Polling for the lock of a target outside a transaction

Outside a transaction block, the migrator takes the lock of its target with `pollLock` in a session: `pg_try_advisory_lock`, again after a pause that grows to 1 s, until it takes it.
A process that waits in `pg_advisory_lock` or `pg_advisory_xact_lock` keeps a snapshot, so `CREATE INDEX CONCURRENTLY` of the process that holds the lock waits for it, while it waits for the lock: PostgreSQL detects the deadlock and fails one of them with `40P01`.
An attempt of `pollLock` keeps a snapshot only while its statement runs.

The design gives up a queue of the waiters, so a waiter can miss the lock while others take it, and takes the lock up to a pause later than a waiter in `pg_advisory_lock` would.

## Waiting in `pg_advisory_lock`

A session could wait in `pg_advisory_lock`, as Kysely and node-pg-migrate with `advisoryLockMode: 'wait'` do, and take the lock as soon as it is released, in the order of the waiters.
The waiters deadlock with a migration that runs `CREATE INDEX CONCURRENTLY`, the case for which migrations run outside a transaction.

## Rejecting when another process holds the lock

A call could reject when another process holds the lock, as Rails and node-pg-migrate by default do, so that no process waits.
Instances of an application that migrate at their start, such as after a deploy, would fail rather than find the target migrated by one of them, so each would need a loop of its own around `migrate`.
