# Tables and Schemas

## Tables

Define each table of the database with `defineTable`, giving its name and columns:

```ts
import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
})
```

See [Types](./types) for the built-in types, column attributes, and custom types.

## Column names

A column is named after its key.
To name it differently, set the name with `columnName`:

```ts
export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  label: t.text,
})
```

### Naming conventions

To name the columns of your tables in snake case, such as `form_id` for `formId`, create your own `defineTable` with `createTableFactory` and use it to define your tables:

```ts
// db/define-table.ts
import { createTableFactory, toSnakeCase } from "kern-orm"

export const defineTable = createTableFactory({ columnName: toSnakeCase })
```

```ts
import * as t from "kern-orm/types"

import { defineTable } from "./db/define-table"

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid, // form_id
  createdAt: t.timestamptz, // created_at
})
```

A run of capital letters is one word, such as `user_id` for `userID` and `json_data` for `JSONData`, and digits stay in their word, such as `line2`.
`columnName` overrides the derived name of a column, such as `t.text.columnName("line_2")`.

For another convention, pass your own function, which gets the key of each column and returns its name:

```ts
export const defineTable = createTableFactory({
  // personCategoryId for person_category_id
  columnName: key => key.replace(/_(.)/g, (_, letter: string) => letter.toUpperCase()),
})
```

## Keys

Mark the primary key column with `primaryKey()` and each column of unique values with `unique()`:

```ts
export const user = defineTable("user", {
  id: t.uuid.primaryKey(),
  email: t.text.unique(),
})
```

List the columns of a key of several columns in the options of `defineTable`:

```ts
export const membership = defineTable(
  "membership",
  {
    userId: t.uuid,
    groupId: t.uuid,
    position: t.integer,
  },
  {
    primaryKey: ["userId", "groupId"],
    unique: [["groupId", "position"]],
  },
)
```

Declare the keys that the database guarantees, such as by a constraint, a unique index, or the query of a view: [relations](#relations) and [`find` and `findBy`](./queries/selecting#record-by-key) rely on them, and a query of a relation `one` fails when it finds several records.

## Tables of one row

To keep a table to one row, such as the settings of an application, declare it with `singleton: true` in the options of `defineTable`, and give it a unique index of `(true)` in its migration:

```ts
export const settings = defineTable(
  "settings",
  {
    id: t.uuid.primaryKey().hasDefault(),
    locale: t.text,
  },
  { singleton: true },
)
```

A query of the table is then a query of its row, such as `await db.settings.upsert({ locale })`; see [Singleton Tables](./singleton-tables).

## Schemas

Put the tables you query in a schema and bind it to the [database](./getting-started#connect) with `bindSchema`:

```ts
import { bindSchema, defineSchema } from "kern-orm"

export const schema = defineSchema({ form, field })

export const db = bindSchema(schema, database)
```

Table keys cannot start with `$`, which schemas and `Db` reserve for their own members.

The schema only describes the tables and their relations, and `db` executes queries on the database.
Start queries from the tables of `db`, such as `db.form`; see [Queries](./queries/).
Where code has no `Db`, such as code shared by several Dbs, start them from the schema instead; see [Queries without a Db](./queries/reusable#queries-without-a-db).

In code that has only `db`, such as a script, reach its database with `$database`:

```ts
await db.$database.close()
```

To reuse tables in several schemas, such as tenant schemas and a shared application schema, include one schema in another; see [Multiple Schemas](./multiple-schemas).

### Database of the current context

When your application gets its database from dependency injection, such as to give tests a database of their own, pass a function that returns it instead of the database, such as with [Ripple DI](https://github.com/IlyaSemenov/ripple-di):

```ts [src/db.ts]
import { bindSchema, createDatabase } from "kern-orm"
import { postgresJsDriver } from "kern-orm/db/postgres-js"
import postgres from "postgres"
import { defineDependency } from "ripple-di"

export const useDatabase = defineDependency(
  () => createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)) }),
  { dispose: database => database.close() },
)

export const db = bindSchema(schema, () => useDatabase())
```

Import `db` and query it as usual.
In the setup of your tests, provide the test database:

```ts
// test/setup.ts
import { install, provide } from "ripple-di"

install(provide(useDatabase, testDatabase))
```

`db` calls the function for each statement, and at the start of `$transaction`, `$session`, and `$lock`, in the async context of the caller; building a query does not call it.
`$isInTransaction()` and `$database` call it too, so that test helpers and [migrations](../migrations/) given `db.$database` or `db` use the database of the context.

The function must return the same database within a transaction or session, such as by providing the database for a whole request or test.

### PostgreSQL schemas

To query tables in a specific PostgreSQL schema, pass `schemaName`; without it, PostgreSQL finds them through `search_path`, which you can override for a [transaction](./transactions#search-path):

```ts
export const db = bindSchema(schema, database, { schemaName: "app" })
```

For a PostgreSQL schema per tenant, pass a function that returns the schema of the current request; one `db` then serves every tenant, since the function is called on every query:

```ts
// useTenant() returns the tenant of the current request
export const db = bindSchema(schema, database, { schemaName: () => useTenant().schema })

await db.form.select("id") // FROM "tenant_1"."form"
```

Read the PostgreSQL schema of a `Db` with `$schemaName`, which calls the function, if any; without `schemaName`, it is `undefined` rather than the schema that `search_path` finds:

```ts
db.$schemaName // "tenant_1"
```

## Relations

Declare relations with `$relations`, listing the relations of each table by name under the key of the table, and use the schema it returns:

```ts
import { defineSchema, many, one } from "kern-orm"

export const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})
```

- `many(field, { from: "id", to: "formId" })` relates a form to the fields whose `formId` equals its `id`.
- `one(form, { from: "formId", to: "id", required: true })` relates a field to the form whose `id` equals its `formId`.

Include a [key](#keys) of the target in the columns `to` of `one`, such as its primary key, so that they match at most one record.

Without the record, a query of a relation `one` gives `null`, and a query of a required relation rejects with `RequiredRelationError` unless it [filters the record](./queries/relations).
Set `required: true` when the database guarantees the record, such as by a foreign key, and the columns `from` are not nullable.

The name of a relation cannot start with `$` or repeat a column of its table: the callbacks of `select` and `where` get both columns and relations.

To load related records in queries, see [Related Records](./queries/relations), and to filter by them, see [Filtering](./queries/filtering#related-records).

For a composite key, list its columns in arrays of the same length:

```ts
contest: one(contest, { from: ["contestId", "rubricId"], to: ["id", "rubricId"] }),
```

Relate columns of the same SQL type, such as two `uuid` columns; `smallint`, `integer`, and `bigint` columns relate to each other as well, and so do `text` and `varchar` ones.
A [custom type](./custom-types#operators) needs the operators of `equalityOperators` to be related.

To share relations between schemas, see [Multiple Schemas](./multiple-schemas#schemas).
