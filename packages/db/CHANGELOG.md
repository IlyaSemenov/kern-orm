# kern-db

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
