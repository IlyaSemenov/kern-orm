# @kern-orm/postgres-js-v3

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

- b0b5870: Initial release of the driver for postgres.js 3.
