# Sequences

To number records apart from their keys with a PostgreSQL sequence, such as the forms as they are published, define the sequence with `defineSequence` and include it in the [schema](./schemas) beside the tables:

```ts
import { bindSchema, defineSchema, defineSequence, defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const form = defineTable("form", {
  id: t.uuid.primaryKey(),
  name: t.text,
  published: t.boolean,
  number: t.bigint.nullable(),
})

export const schema = defineSchema({
  form,
  formNumberSeq: defineSequence("form_number_seq"),
})

export const db = bindSchema(schema, database, { schemaName: "app" })
```

`db.formNumberSeq` is the sequence in the [PostgreSQL schema](./schemas#postgresql-schemas) of `db`, as `db.form` is the table, also when `schemaName` is a function.

Give each sequence a key of its own, which cannot start with `$` or repeat the key of a table.

## Next values

Take the next value of the sequence with `nextval()`, such as in an update:

```ts
await db.form
  .where({ id: formId, published: false })
  .update({ published: true, number: db.formNumberSeq.nextval() })
// SQL: UPDATE "app"."form" AS "form" SET "published" = $1, "number" = nextval('"app"."form_number_seq"'::regclass) WHERE "form"."id" = $2 AND "form"."published" = $3
```

Interpolate it the same way into a [SQL statement](./queries/sql):

```ts
const publishedIds = await db.$query`
  UPDATE ${db.form} SET published = true, number = ${db.formNumberSeq.nextval()}
  WHERE NOT published
  RETURNING id
`.pluck(t.uuid)
```

The value of `nextval()` is a `bigint`, as of a [`bigint` column](./types).

`currval()` and `setval(value, isCalled?)` give the calls of the PostgreSQL functions of the same names, such as to start the sequence over:

```ts
await db.$query`SELECT ${db.formNumberSeq.setval(1, false)}`
```

In a query [without a `Db`](./queries/composing#queries-without-a-db), take the sequence from the schema, such as `schema.formNumberSeq`, since a sequence of `db` runs only in the queries of `db`.

## The name of the sequence

Where a statement takes the name of the sequence, interpolate the sequence itself:

```ts
const lastNumber = await db.$query`SELECT last_value FROM ${db.formNumberSeq}`.get(t.bigint)
// SQL: SELECT last_value FROM "app"."form_number_seq"
```
