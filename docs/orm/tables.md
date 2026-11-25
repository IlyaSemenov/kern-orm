# Tables

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

The definitions describe tables that already exist: create and change them with SQL or [migrations](../migrations/getting-started), and check in a test that they [match the database](./testing#tables-that-match-the-database).

Put the tables in a [schema](./schemas), then query them through your application's `db`:

```ts
import { db } from "#db"

const forms = await db.form.where({ published: true }).select("id", "name")
// forms: { id: string; name: string }[]
```

See [Queries](./queries/) for selecting, filtering, and changing records.

To keep a table to one row, such as the settings of an application, see [Singleton Tables](./singleton-tables).
To read a PostgreSQL view, see [Views](./views).

## Columns

Give each column a [type](./types), followed by its attributes:

```ts
export const field = defineTable("form_field", {
  id: t.uuid.primaryKey().hasDefault(),
  formId: t.uuid.columnName("form_id"),
  label: t.text,
  hint: t.text.nullable(),
})
```

Column attributes set what belongs to the table:

- `.columnName("form_id")` sets the name of the column in the database; see [Column names](#column-names).
- `.primaryKey()` and `.unique()` mark a [key](#keys) of the table.
- `.hasDefault()` lets [inserts](./queries/mutations#inserting) omit a column that the database fills in, such as by `DEFAULT` or an identity.
- `.default(value)` lets inserts omit the column and inserts `value` instead; see [Defaults in code](#defaults-in-code).

Changes of the type, such as [`nullable`](./types#nullable-values) and [`transform`](./types#deriving-types), come before column attributes: `t.text.nullable().columnName("note")`.
Types and columns are immutable, so you can reuse them across tables, such as with [presets](./types#presets).

Column keys cannot start with `$`, which kern-orm reserves for its own members.

### Defaults in code

To fill in a column in your application rather than in the database, pass its default to `.default()`: a value, a [`sql` fragment](./queries/filtering#sql-fragments), or a function that returns one.

```ts
import { randomUUID } from "node:crypto"

import { defineTable, sql } from "kern-orm"
import * as t from "kern-orm/types"

export const task = defineTable("task", {
  id: t.uuid.primaryKey().default(() => randomUUID()),
  state: t.text.default("draft"),
  dueAt: t.timestamptz.default(() => (isUrgent() ? sql`now()` : sql`now() + interval '1 day'`)),
})
```

kern-orm calls the function for each record that omits the column, each time the insert runs.
The database needs no default of its own for such a column.

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

A column of a nullable type cannot be part of the primary key.

Declare the keys that the database guarantees, such as by a constraint, a unique index, or the query of a view: [relations](./schemas#relations) and [`find` and `findBy`](./queries/selecting#record-by-key) rely on them, and a query of a relation `one` fails when it finds several records.

## Column names

A column is named after its key.
To name it differently, set the name with `columnName`, as `formId` of `field` above does.

### Naming conventions

To use snake case for table and view columns, such as `form_id` for `formId`, export both functions from one factory:

```ts
// db/table-factory.ts
import { createTableFactory, toSnakeCase } from "kern-orm"

export const { defineTable, defineView } = createTableFactory({ columnName: toSnakeCase })
```

```ts
import * as t from "kern-orm/types"

import { defineTable } from "./db/table-factory"

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid, // form_id
  createdAt: t.timestamptz, // created_at
})
```

The factory's `defineView` applies the same conversion, so `formId: t.uuid` reads `form_id` in a view as well.

A run of capital letters is one word, such as `user_id` for `userID` and `json_data` for `JSONData`, and digits stay in their word, such as `line2`.
`columnName` overrides the derived name of a column, such as `t.text.columnName("line_2")`.

For another convention, pass your own function, which gets the key of each column and returns its name:

```ts
export const { defineTable, defineView } = createTableFactory({
  // personCategoryId for person_category_id
  columnName: key => key.replace(/_(.)/g, (_, letter: string) => letter.toUpperCase()),
})
```
