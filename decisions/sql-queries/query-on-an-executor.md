# `queryOn` of an executor of statements

`queryOn` of `kern-db` takes an object that executes statements, a `StatementExecutor`, and returns the template that starts a [query of SQL text](../../architecture/sql-queries.md) on it, as `query` of a `Database` starts it on the database.
So a library runs its statements as templates with typed results on what it has: a driver, a dedicated connection, a `Database`, or a wrapper of `execute`, such as one that records the time of each statement.

```ts
import type { StatementExecutor } from "kern-db"
import { queryOn } from "kern-db"

function countPendingJobs(executor: StatementExecutor) {
  return queryOn(executor)`SELECT count(*) FROM job WHERE state = ${"pending"}`.get(t.integer)
}
```

The alternatives:

- A method of a fragment that starts its query, such as ``sql`…`.on(executor)``, would let one fragment, built once, start queries on several executors.
  But every fragment would have it, also a name of `identifier` and the columns of a record, which are not statements; `sql` of kern-orm, which makes an expression rather than a fragment of the layer, would lack it under the same name; and a fragment would no longer be only data, which a query builder creates and renders by the builder API.
  Kysely chose it: ``sql`…`.execute(db)`` takes any provider of an executor, such as a transaction ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/raw-builder.ts#L139-L142)).
- `query` of `Driver` and `Connection`, as of `Database`, would be found on the object at hand.
  But both are contracts that applications implement, so every custom driver would implement the template, or wrap its connections with a helper of kern-db, and a wrapper of `execute` would still have none.
  Postgres.js chose it for its own client: `reserve` returns the template of a reserved connection ([source](https://github.com/porsager/postgres/blob/v4.1.0/src/index.js#L183-L191)).
- A `Database` created over each executor would give the whole API of a database.
  But `createDatabase` takes a `Driver`, so a connection or a wrapper of `execute` would be dressed as a driver whose `acquire` has no meaning, and each database creates a transaction coordinator that routes its statements by the async context, which a statement for one known connection does not need.
- `startSqlQuery` of `kern-db/builder` alone would leave each such library to write the source of each statement, which renders its fragment with `renderFragment` and a binder of its own, as a query builder does, or to keep a wrapper of its own over SQL text.
- The name `query`, as of a `Database`, would be shadowed by the `const query = …` that modules commonly declare for a query, whose own initializer then calls it before its declaration.
