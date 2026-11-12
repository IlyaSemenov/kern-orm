# kern-db

## 0.5.0

### Minor Changes

- b64ad58: Add `openTestFixture` and `openTestTransaction` to isolate browser tests against a running server in transactions that roll back after each test.
- fc7fcff: Fix test transactions failing every later query of a test once a query of the tested code outside a transaction failed, such as an insert that violates a unique constraint, and queries of a test failing beside a running transaction of the tested code; a test that passes also waits for the transactions that it started without awaiting them instead of failing.
- feabf2f: Add `wrapTest` to run `node:test` and `bun:test` tests in test transactions, which roll back as soon as a test times out; under `bun:test`, pass `onTestFinished` to `createTestHelpers` for that.

## 0.4.0

### Minor Changes

- 2ca43cc: Add `error.unsent` to `ConnectionError`, for which `isOutcomeUnknown` returns `false` when it is `true`, and require `createUnreachableDriver` in `describeDriverContract`.

## 0.3.0

### Minor Changes

- 1cf41eb: Add helpers to read backend PIDs and wait for blocked statements in `kern-db/testing` and `kern-orm/testing`.
- 9923ac1: Add `isOutcomeUnknown`, which tells whether the outcome of a failed statement or transaction is unknown because its connection failed.

## 0.2.0

### Minor Changes

- 96bc354: Add `isDriver` and `isDatabase` to `kern-db` and `kern-orm/db`, which tell a driver and a database from another value, such as a client of PostgreSQL passed instead.

## 0.1.0

### Minor Changes

- 614dfd7: Release `kern-db`, the database layer of `kern-orm`, which works without the ORM.
