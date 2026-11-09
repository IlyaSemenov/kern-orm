# @kern-orm/postgres-js

## 0.3.0

### Minor Changes

- d5abb00: Require `kern-orm` 0.9.0 or later, whose `Driver` has no `closesReservedConnections`.

## 0.2.0

### Minor Changes

- 17acc74: Add `closesReservedConnections` to `Driver`, which tells whether a driver closes a reserved connection that it cannot return to the pool, `false` for postgres.js 3; `describeDriverContract` reads it from the driver instead of its option.
- fbd09a2: Throw a `TypeError` for a client that transforms the column names or rows of results, such as with `postgres.camel`, whose results kern-orm cannot read.
- c2a2ee9: Reject with `QueryError` and `ConnectionError`, which requires `kern-orm` 0.8.0 or later.

## 0.1.3

### Patch Changes

- cdcac34: Fix a statement or script on the pool of a closing driver running instead of rejecting when it was sent right after `close()`, or, with postgres.js 3, while closing waited for transactions.

## 0.1.2

### Patch Changes

- 219ef99: Work with the `kern-orm` of the application, any 0.x version from 0.2.0, as a peer dependency, instead of installing another copy for each new minor version.

## 0.1.1

### Patch Changes

- Updated dependencies: kern-orm@0.2.0

## 0.1.0

### Minor Changes

- ddf23b1: Initial release.
