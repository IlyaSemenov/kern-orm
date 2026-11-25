# Views

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

const fields = await db.publishedField.where({ label: "Email" }).select("formId", "label")
// fields: { formId: string; label: string }[]
```

To apply the same [column naming convention](./tables#naming-conventions) to your tables and views, import both definition functions from your table factory module.
Declare `nullable()` for a column whose result can be null.
Create and change the SQL definition in a [migration](../migrations/helpers).

A view declared with `defineView` is read-only and its columns cannot declare keys or defaults.
Use `where` to look up its rows: `find`, `findBy`, and relations `one` targeting the view require a key.
If you need to declare a key guaranteed by the view's query or write through an updatable view, describe it with [`defineTable`](./tables).
