# Tables and Views

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

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  label: t.text,
})
```

See [Types](./types) for the built-in types, column attributes, and custom types, and [Column names](#column-names) for `columnName`.
To query the tables, put them in a [schema](./schemas).
To keep a table to one row, such as the settings of an application, see [Singleton Tables](./singleton-tables).

The definitions describe tables that already exist: create and change them with SQL or [migrations](../migrations/getting-started), and check in a test that they [match the database](./testing#tables-that-match-the-database).

## Views

Use `defineView` to read an ordinary or materialized PostgreSQL view through a schema:

```ts
import { defineView } from "kern-orm"
import * as t from "kern-orm/types"

export const publishedField = defineView("published_field", {
  formId: t.uuid.columnName("form_id"),
  label: t.text,
})
```

Include the view in the [schema](./schemas) alongside your tables, then query it through your application's `db`:

```ts
import { db } from "#db"

const formsWithEmail = db.form.where(form =>
  db.publishedField.where({ formId: form.id, label: "Email" }).exists(),
)
```

To apply the same [column naming convention](#naming-conventions) to your tables and views, import both definition functions from your table factory module.
Declare `nullable()` for a column whose result can be null.
Create and change the SQL definition in a [migration](../migrations/helpers).

A view declared with `defineView` is read-only and its columns cannot declare keys or defaults.
Use `where` to look up its rows: `find`, `findBy`, and relations `one` targeting the view require a key.
If you need to declare a key guaranteed by the view's query or write through an updatable view, describe it with `defineTable`.

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

Declare the keys that the database guarantees, such as by a constraint, a unique index, or the query of a view: [relations](./schemas#relations) and [`find` and `findBy`](./queries/selecting#record-by-key) rely on them, and a query of a relation `one` fails when it finds several records.

## Column names

A column is named after its key.
To name it differently, set the name with `columnName`, as `formId` of `field` [above](#tables) does.

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
