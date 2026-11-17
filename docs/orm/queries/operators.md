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
- numbers: `add`, `sub`, `mul`, and `div`, and for integers and `numeric` also `mod`.

To match `NULL`, call `isNull` rather than pass `null` to a comparison.

The result of an operator has the operators of its own type, so you can chain them:

```ts
await db.form.where(form => form.name.lower().like("draft%")).select("id")

await db.form.where(form => form.name.trim().length().gt(100)).select("id")
```

## Arithmetic

Call `add`, `sub`, `mul`, `div`, and `mod` to compute a number, such as the number of a field counted from one:

```ts
const fields = await db.field.where({ formId }).select(field => ({
  id: field.id,
  number: field.position.add(1),
}))
// fields: { id: string; number: number }[]

await db.field.where(field => field.position.mod(2).eq(0)).select("id")
```

The result has the type of the column or expression you call the operator on.
The operator takes an operand of the values of that type: a number for `integer`, a `bigint` or a number for `bigint`, and a string or a number for `numeric`.
PostgreSQL computes it as for the SQL operators `+`, `-`, `*`, `/`, and `%`, so dividing an integer by an integer drops the fraction: call `div` on a column of `numeric` or `doublePrecision` for a fractional quotient.
The result is read by the type you call the operator on, so call it on the wider type, such as on a `doublePrecision` column beside an `integer` one.
An operand cannot be an expression of other values, such as a `bigint` column beside an `integer` one; write a [`sql` fragment](./filtering#sql-fragments) of the wider type for it.

To increment a column, see [Updating](./mutations#updating).

## Beyond the operators

For a condition or a value that operators do not cover, write a [`sql` fragment](./filtering#sql-fragments).
To add an operator to a type, see [Custom types](../custom-types#operators).
