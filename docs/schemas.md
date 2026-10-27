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

### Keys

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

## Schemas

Put the tables you query in a schema and bind it to the [database](./getting-started#connect) with `database.bind`:

```ts
import { defineSchema } from "kern-orm"

export const schema = defineSchema({ form, field })

export const db = database.bind(schema)
```

Do not start table keys with `$`, which schemas and `Db` reserve for their own members.

The schema only describes the tables and their relations, and `db` executes queries on the database.
Start queries from the tables of `db`, such as `db.form`; see [Queries](./queries/).
Where code has no `Db`, such as with dependency injection, start them from the schema instead; see [Queries without a Db](./queries/reusable#queries-without-a-db).

To reuse tables in several schemas, such as tenant schemas and a shared application schema, include one schema in another; see [Multiple Schemas](./multiple-schemas).

### PostgreSQL schemas

To query tables in a specific PostgreSQL schema, pass `schemaName`; without it, PostgreSQL finds them through `search_path`:

```ts
export const db = database.bind(schema, { schemaName: "app" })
```

For a PostgreSQL schema per tenant, pass a function that returns the schema of the current request; one `db` then serves every tenant, since the function is called on every query:

```ts
// useTenant() returns the tenant of the current request
export const db = database.bind(schema, { schemaName: () => useTenant().schema })

await db.form.select("id") // FROM "tenant_1"."form"
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

Without the record, a query of a relation `one` gives `null`, and a query of a required relation rejects.
Set `required: true` when the database guarantees the record, such as by a foreign key, and the columns `from` are not nullable.

Name a relation differently from the columns of its table, and do not start its name with `$`: the callback of `select` gets both columns and relations.

To load related records in queries, see [Related Records](./queries/relations).

For a composite key, list its columns in arrays of the same length:

```ts
contest: one(contest, { from: ["contestId", "rubricId"], to: ["id", "rubricId"] }),
```

Relate columns of the same SQL type, such as two `uuid` columns; `smallint`, `integer`, and `bigint` columns relate to each other as well, and so do `text` and `varchar` ones.
A [custom type](./custom-types#operators) needs the operators of `equalityOperators` to be related.

To share relations between schemas, see [Multiple Schemas](./multiple-schemas#schemas).
