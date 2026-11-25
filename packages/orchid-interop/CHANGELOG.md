# @kern-orm/orchid-interop

## 0.1.8

### Patch Changes

- Updated dependencies: kern-db@0.16.0

## 0.1.7

### Patch Changes

- Updated dependencies: kern-db@0.15.0

## 0.1.6

### Patch Changes

- Updated dependencies: kern-db@0.14.0

## 0.1.5

### Patch Changes

- Updated dependencies: kern-db@0.13.0

## 0.1.4

### Patch Changes

- Updated dependencies: kern-db@0.12.0

## 0.1.3

### Patch Changes

- Updated dependencies: kern-db@0.11.0

## 0.1.2

### Patch Changes

- Updated dependencies: kern-db@0.10.0

## 0.1.1

### Patch Changes

- Updated dependencies: kern-db@0.9.0

## 0.1.0

### Minor Changes

- 4f3196d: Allow the callbacks of transactions, sessions, test helpers, and `runInOrchidTransaction()` to return a query directly without `async`, such as `db.$transaction(() => db.post.insert(values))`.
- d2c66f2: Add an experimental adapter that runs Orchid ORM and kern-orm queries on one connection pool and in the same transactions.

### Patch Changes

- Updated dependencies: kern-db@0.8.0
