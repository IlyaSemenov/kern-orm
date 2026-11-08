# Singleton tables

A table that holds at most one row declares it by the option `singleton` of `defineTable`, and a query of the table starts as a query of its row, in rows `optional` without a limit, as of `find` of a key without columns, whose `upsert` inserts or updates the row by `ON CONFLICT ((true))`, the expression of its unique index.

```ts
const license = defineTable(
  "license",
  {
    token: t.text,
  },
  { singleton: true },
)

const current = await db.license.get("token") // string | undefined
await db.license.upsert({ token: "new-token" })
await db.license.update({ token: "new-token" })
```

The alternatives keep the queries of a table as they are, but each costs code at every query or reads as something else:

- A column of a constant, unique and checked, such as `singletonKey` of a default `1`, makes the row the record of a key, which `findBy` and its `upsert` take without a feature of their own, as projects on Orchid ORM did ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)).
  Every query passes the constant, and the table has a column that holds no data:

  ```ts
  await db.license.findBy({ singletonKey: 1 }).upsert({ token })
  ```

- A unique index of `(true)` with the queries of a table of many rows reads the row with `take` and changes it with `all`, as Orchid ORM does.
  `all` reads as a change of every row, so each call needs a comment, and `take` adds a limit, which hides a second row:

  ```ts
  await db.license.all().take().upsert({ data: { token }, create: {} })
  ```

- A key without columns in the options, `unique: [[]]`, puts the row among the keys, whose `findBy({})` and `onConflict()` would take it without an option of their own, but reads as a key that matches every row.

A query of a table states by its type whether it is a query of the row: the entries of a schema and a `Db` type it by `TableQueryState`, a conditional type of the table, rather than by `InitialQueryState` alone, and `from` by overloads of the states of either kind of table.
The conditional costs the first use of an entry and the first comparison of two `Db` types more instantiations, also for a schema without singleton tables, whereas the methods of a query cost the same ([benchmark](../../benchmarks/types/first-use.bench.ts)):

- The first comparison of two `Db` types, such as of a `Db` passed as a `DbOf`, costs about 11% more for 2 tables and 12% more for 12 tables, mostly a part that does not grow with the tables.
- The first expression of a table costs about 9% more, its first helper 2% more, and the first query 1% more.
- A table defined with options costs about 3% more for the type of `singleton`, and one without options the same.

The conditional is distributive over the `singleton` of the type of the table, so that a table of a generic type, such as `T extends typeof form`, gives the state of the constraint of its `singleton`.
A conditional type of `T["singleton"]` itself costs about as much, but gives such a table the states of both, so that `limit` rejects its query; a lookup of an interface of both states by `` `${T["singleton"]}` `` gives the state of the constraint too, but costs the first comparison of two `Db` types 18% and 24% more.
TypeScript defers either conditional for a table of a generic type, so the table of its state is not that type itself: `from` has overloads instead, so that `from(table).insert(values)` of `T extends typeof form` takes values of `InsertValues<T>`, whereas the entry of a schema or a `Db` of such a table rejects them.
