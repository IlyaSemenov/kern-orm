# Requests of an open test transaction that take turns on its connection

An open test transaction of `openTestTransaction` is a test level that the callbacks of `run`, such as the requests of one browser test to a server, share until it closes.
They share its one connection, and PostgreSQL runs one transaction on a connection, so the callbacks take turns on it:

- A transaction of a callback, which runs as a savepoint, holds the connection from its `SAVEPOINT` until it ends, and the statements and transactions of the other callbacks wait for it.
- Each statement or script of a callback outside a transaction runs in a savepoint of its own, released when it succeeds and rolled back when it fails.

```sql
-- POST /forms, which violates a unique constraint
SAVEPOINT kern_2; INSERT INTO form ...; ROLLBACK TO SAVEPOINT kern_2; RELEASE SAVEPOINT kern_2;
-- GET /forms, after it
SAVEPOINT kern_2; SELECT ... FROM form; RELEASE SAVEPOINT kern_2;
```

## Rejecting a statement beside a running transaction

A callback of a test transaction rejects a statement or a nested level while a nested level runs, since PostgreSQL would run it inside that savepoint.
The requests of a browser test run at once, as the browser sends them, so a request that queries while another one runs a transaction would fail at random.
Waiting gives what production gives: a request sees the changes of a transaction of another request once it commits.
Waiting has a cost of its own: a transaction that waits for another request of the same test, such as for a request to the same server, waits until the test ends, where it would complete in production.

## A turn for a whole request

Each callback of `run` could hold the connection until it settles, which needs no turns for statements and transactions.
A request that waits for something outside the database, such as a long poll or a stream of server-sent events, would then hold every other request of the test, and the requests of a page that loads its parts at once would run one after another.

## Statements outside a transaction without savepoints

A statement could run in the open test transaction itself, which saves the `SAVEPOINT` and the `RELEASE` of each statement, two round trips of three.
A failed statement then aborts the transaction, and PostgreSQL rejects every later statement of the test, while in production a failed statement outside a transaction undoes only itself; requests fail such statements on purpose, such as an insert that violates a unique constraint to answer with a conflict.

## Truncating tables between tests

A server for browser tests could commit its requests and truncate every table before each test, as Django does for `LiveServerTestCase`, which needs nothing of the test levels.
It cannot run tests in parallel workers on one database, and it prepares the shared data of every test again, while a test fixture prepares it once and rolls the test back to it.
