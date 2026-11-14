# Defaults of kern-orm added when the insert runs

A default of kern-orm of a column, of `default`, is added to the records of an insert that omit the column when the insert runs, by lowering, rather than when `insert` is called.

```ts
const task = defineTable("task", {
  id: t.uuid.primaryKey().default(() => randomUUID()),
  name: t.text,
})

const insert = db.task.insert({ name: "Write" })
await insert // inserts one UUID
await insert // inserts another, as a default of the database would
```

The mutation keeps the records as given, so:

- A mutation that runs again gets new values, as from a default of the database, and a function of a default reads the async context of the run, as the PostgreSQL schema of a `Db` is resolved.
- `merge` reads which columns the records give, so `upsert` and `merge` without columns leave out a column that only its default gives, and keep the value of the existing record, as for a default of the database, with no mark of the values that defaults give.

It gives up:

- A deterministic `toSQL`: each call calls the functions of the defaults again, so it gives other parameters for a default such as `() => randomUUID()`.
- Reading every value when `insert` is called: a function of a default that throws rejects the run, rather than throws at the call.

Drizzle ORM also calls `$defaultFn` of a column when it builds the statement of an insert, each time the insert runs, and takes a SQL fragment from it ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L541-L546)).
