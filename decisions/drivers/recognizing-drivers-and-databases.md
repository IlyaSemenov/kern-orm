# Drivers recognized by their methods, databases by a brand

`isDriver` checks that `execute`, `executeScript`, `acquire`, and `close` are functions, and `isDatabase` recognizes a database by a brand of `Symbol.for`, which `createDatabase` sets as a property that is not enumerable:

```ts
// A package that takes the driver or the database of an application
if (!isDriver(driver)) {
  throw new TypeError("driver must be a driver of kern-db")
}
if (!isDatabase(database)) {
  throw new TypeError("database must be a database of kern-db")
}
```

A driver is a contract that an application may implement as a custom driver, while a database comes only from `createDatabase`.

The alternatives:

- A brand of a driver, which the drivers of kern-db set, would also reject an object with the methods of a driver that is not one, but it would reject every custom driver that does not set the brand, including those written before it.
- The methods of a database, such as `transaction` and `session`, would accept an object that implements them, such as a wrapper that logs statements, and a database of a copy of kern-db older than the brand.
  They would also accept a copy of a database, which the test helpers reject since they find no coordinator for it, and an object written by hand whose transactions do not route statements as a database does.

The brand of a database recognizes a database of another copy of kern-db, as the brands of [errors](error-recognition.md) do, so that a package that requires kern-db by a peer dependency accepts the database of the application when the package manager installs a copy of its own.
