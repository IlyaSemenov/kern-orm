# Building Packages

::: info For library authors
This page is for authors of packages that store their data in the database of an application, such as a form builder with tables of its own.
To compile SQL on top of kern-db, see [Building Query Builders](./query-builders).
:::

Take the database or the driver of the application as an option of your package, and check it with `isDatabase` or `isDriver`, so that a caller from JavaScript who passes something else, such as the client of PostgreSQL, gets a clear error before your package runs a statement:

```ts [src/form-builder.ts]
import type { Database } from "kern-db"
import { isDatabase } from "kern-db"

export function createFormBuilder(database: Database) {
  if (!isDatabase(database)) {
    throw new TypeError("database must be created by createDatabase of kern-db")
  }
  // ...
}
```

`isDatabase` accepts a database created by `createDatabase`, including one of another copy of kern-db.
`isDriver` accepts any object with the methods of a driver, also a [custom driver](./custom-drivers).

Require `kern-db` in `peerDependencies` of your package, by a range of one minor line, such as `^0.2.0`: the package manager then shares the copy of kern-db of the application with your package when its version is in your range.
