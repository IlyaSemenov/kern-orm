# Operators

Columns and other expressions have the operators of their type.
Call them in the callback of a query to build a condition or compute a value:

```ts
await db.form.where(form => form.name.ilike("draft%")).select("id")

const forms = await db.form.select(form => ({
  id: form.id,
  isUntitled: form.name.eq("Untitled"),
}))
// forms: { id: string; isUntitled: boolean }[]
```

Operators by type:

- every type: `isNull`;
- types with SQL `=`, which are every built-in type except `json` and arrays of it: `eq`, `ne`, and `in`;
- ordered types, which are numbers, text, `uuid`, dates, times, intervals, `inet`, `cidr`, and enums: `lt`, `lte`, `gt`, and `gte`;
- `text`, `varchar`, and `char`: `like`, `ilike`, `lower`, `upper`, `trim`, and `length`.

To match `NULL`, call `isNull` rather than pass `null` to a comparison.

The result of an operator has the operators of its own type, so you can chain them:

```ts
await db.form.where(form => form.name.lower().like("draft%")).select("id")

await db.form.where(form => form.name.trim().length().gt(100)).select("id")
```

For a condition or a value that operators do not cover, write a [`sql` fragment](./filtering#sql-fragments).
To add an operator to a type, see [Custom types](../custom-types#operators).
