# Levels of the test helpers that take turns on their connection

The levels of the test helpers that code runs in, a test transaction, the seed of a test fixture, and an open test transaction, which the requests of one browser test to a server share, emulate the pool for that code on their one connection:

- A transaction of the code, which runs as a savepoint, holds the connection from its `SAVEPOINT` until it ends, and the statements and transactions that the test or the other requests run at once wait for it.
- Each statement or script of the code outside a transaction runs in a savepoint of its own, released when it succeeds and rolled back when it fails, so that a failed statement undoes only itself, as outside a transaction in production.

```sql
-- POST /forms, which violates a unique constraint
SAVEPOINT kern_2; INSERT INTO form ...; ROLLBACK TO SAVEPOINT kern_2; RELEASE SAVEPOINT kern_2;
-- GET /forms, after it
SAVEPOINT kern_2; SELECT ... FROM form; RELEASE SAVEPOINT kern_2;
```

## Statements outside a transaction without savepoints

A statement could run in the test level itself, which saves the `SAVEPOINT` and the `RELEASE` of each statement.
A failed statement then aborts the transaction, and PostgreSQL rejects every later statement of the test, while in production a failed statement outside a transaction undoes only itself; code fails such statements on purpose, such as an insert that violates a unique constraint to answer with a conflict, and a test of that code goes on after it.

The savepoints cost a statement of a test 1.7 to 2.0 times its time alone with postgres.js, which sends the statement right behind its `SAVEPOINT`, and 2.7 to 2.9 times with node-postgres, which sends it after the `SAVEPOINT` completes, for a read and a write alike: 30 to 50 µs more on a local connection ([benchmark](../../benchmarks/suites/test-statement-savepoints.ts)).

## Rejecting a statement beside a running transaction

A level could reject a statement or a nested level while a nested level runs, since PostgreSQL would run it inside that savepoint, as a transaction of `transaction` rejects them.
With a savepoint of each statement, statements that a test runs at once, such as with `Promise.all`, would reject each other, and the requests of a browser test, which run at once as the browser sends them, would fail at random when one of them runs a transaction.
Waiting gives what production gives: a statement sees the changes of a transaction once it commits.
Waiting has a cost of its own: a transaction that waits for a statement that the test or another request of the same test runs outside of it, such as a request to the same server, waits until the test ends, where it would complete in production.

## A turn for a whole request

The open test transaction could let each callback of `run` hold the connection until it settles, which needs no turns for statements and transactions.
A request that waits for something outside the database, such as a long poll or a stream of server-sent events, would then hold every other request of the test, and the requests of a page that loads its parts at once would run one after another.

## Truncating tables between browser tests

A server for browser tests could commit its requests and truncate every table before each test, as Django does for `LiveServerTestCase`, which needs nothing of the test levels.
It cannot run tests in parallel workers on one database, and it prepares the shared data of every test again, while a test fixture prepares it once and rolls the test back to it.
