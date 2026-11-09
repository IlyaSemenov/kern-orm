# @kern-orm/node-postgres

## 0.3.0

### Minor Changes

- d5abb00: Require `kern-orm` 0.9.0 or later, whose `Driver` has no `closesReservedConnections`.
- 6d8d33f: Fix a statement or script on the pool, such as `BEGIN`, leaving a transaction open for later statements of the pool: it rejects, and the transaction rolls back.

### Patch Changes

- 6d8d33f: Reuse a connection left idle after PostgreSQL rejects `COMMIT`, such as for a deferred constraint, instead of reconnecting for the next statement.

## 0.2.0

### Minor Changes

- 17acc74: Add `closesReservedConnections` to `Driver`, which tells whether a driver closes a reserved connection that it cannot return to the pool, `false` for postgres.js 3; `describeDriverContract` reads it from the driver instead of its option.
- c2a2ee9: Reject with `QueryError` and `ConnectionError`, which requires `kern-orm` 0.8.0 or later.

## 0.1.0

### Minor Changes

- 6b34999: Initial release of the driver for node-postgres.
