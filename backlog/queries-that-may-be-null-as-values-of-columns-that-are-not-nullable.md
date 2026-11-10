# Queries that may be `NULL` as values of columns that are not nullable

Types take a query of one value that is `NULL` without its row as a value of a column that is not nullable, such as `db.field.insert({ formId: db.form.where({ name }).get("id"), ... })`, and PostgreSQL rejects the statement without the row, while types reject an expression that may be `NULL` ([architecture/mutations.md](../architecture/mutations.md#values)).

- Think again about whether types keep taking such a query, which moves the error from type-checking to the statement, or reject it as they reject an expression.
- Preliminary decision: types reject such a query unless it is explicitly marked as having its row, as the `!` operator of TypeScript marks a value.
  - The mark changes only the value of the query in an expression, `ScalarValue` of `query/operand.ts`, which already has no `null` for the guaranteed row of a required relation; PostgreSQL still rejects `NULL` for a column that is not nullable.
  - An executed query and a nested query of a selection reject without their row anyway, so the mark means nothing for them.
  - Decide the API of the mark with that in mind.
