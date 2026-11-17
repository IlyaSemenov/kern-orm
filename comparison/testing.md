# Testing

## Tests in transactions that roll back

Test helpers run each test in a transaction that rolls back, and the transactions of the code under test, which queries the `db` of the application, run in it as nested transactions.

- Drizzle ORM, lacks: it has no test helper, and the code under test joins a transaction of a test only through a `tx` passed to it ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/node-postgres/session.ts#L283-L300)).
- Kysely, lacks: it has no test helper, and `transaction` of a transaction throws, so code under test that starts a transaction cannot run in one of a test ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/kysely.ts#L675-L690)).
- Prisma ORM, lacks: its guide of integration tests deletes the data after the tests instead of rolling back ([docs](https://www.prisma.io/docs/orm/v7/prisma-client/testing/integration-testing)), and jest-prisma runs each Jest test in a transaction that rolls back ([docs](https://github.com/Quramy/jest-prisma/blob/v1.8.2/README.md#transaction-rollback)).
- Orchid ORM, same: `testTransaction` runs each test in a transaction that rolls back, and the transactions of the code under test in it as savepoints ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#testtransaction)).

## Statements outside a user transaction during a test

Kern runs each statement outside a user transaction inside a savepoint, so a PostgreSQL rejection rolls back only the statement and the test transaction remains usable.

- Orchid ORM 1.78.61 with pqb 0.73.50, differs: `testTransaction` routes a plain query directly to the test transaction's adapter, so an ordinary statement outside a user transaction uses no savepoint of its own ([test transaction and query execution](https://unpkg.com/pqb@0.73.50/dist/index.mjs)).

## Late work of a finished test

Work that outlives its test transaction, such as of a timed-out test, rejects instead of running in the next test, and a fixture whose seed never settles closes before the next scope opens its fixture.

- Orchid ORM, fails: it ran such work in the next test or on the pool, and the rest of such a seed in the enclosing test transaction ([orchid-orm#798](https://github.com/romeerez/orchid-orm/issues/798)).

## A failed statement of a test

The next test of a fixture runs after a statement of a test fails, and a test transaction whose `SAVEPOINT` fails rejects without calling its callback, and the next one starts.

- Orchid ORM, fails: it failed every later test of the file once a statement failed in its test transaction, and never settled the start of a test transaction whose `SAVEPOINT` failed ([orchid-orm#802](https://github.com/romeerez/orchid-orm/pull/802)).

## Preempting a test transaction

A test transaction that a rollback preempts, also with a nested transaction still running, completes the statements it has sent before the rollback, and its later statements fail.

- Orchid ORM, fails:
  - it ran the later queries of a test whose savepoint an outer rollback ended in the enclosing test transaction ([orchid-orm#816](https://github.com/romeerez/orchid-orm/pull/816));
  - it preempted a test transaction whose nested transaction still ran ([orchid-orm#833](https://github.com/romeerez/orchid-orm/pull/833)), and could roll the test back to a savepoint of the same name in it rather than its own ([orchid-orm#814](https://github.com/romeerez/orchid-orm/pull/814)).

## Starts and rollbacks of test transactions

Test transactions start one after another while a preemption is held, a late rollback leaves the next fixture open, and a start aborted in the queue rejects at once without preempting the active level.

- Orchid ORM, fails:
  - it ran a start and a rollback at once and left the state of the rollback in the next test, and let a late rollback end the test transaction of the next test ([orchid-orm#809](https://github.com/romeerez/orchid-orm/pull/809)) or route its queries to a rolled back one ([orchid-orm#815](https://github.com/romeerez/orchid-orm/pull/815));
  - it rejected a cancelled start only in its turn, behind the rollback of a test whose statement still ran ([orchid-orm#812](https://github.com/romeerez/orchid-orm/pull/812)).

## Requests of browser tests to a running server

The requests that a browser test sends to a server run in a test transaction that the server opens and rolls back for the test, on one connection: their transactions run one at a time as savepoints, and each of their statements outside a transaction runs in a savepoint of its own.

- Rails, differs: its transactional tests pin one connection in a transaction that the threads of the server share, and it holds the lock of the connection for a whole transaction of a thread, whose nested transactions are savepoints; it runs a statement outside a transaction in the transaction of the test without a savepoint of its own ([`pin_connection!`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/connection_pool.rb), [`within_new_transaction`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/transaction.rb), [`with_raw_connection`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract_adapter.rb)).
- Django, differs: `LiveServerTestCase` runs a server for browser tests as `TransactionTestCase` does, which truncates every table after a test instead of rolling a transaction back ([testing tools](https://docs.djangoproject.com/en/6.0/topics/testing/tools/#liveservertestcase)).
