# Branded types of columns

An opt-in `brand()` of a column gives its values a type distinct from other values of the same underlying type, so that types reject a mixed-up identifier, such as `db.field.find(formId)` or `db.field.where({ id: formId }).delete()`.

Orchid ORM has [`brand()`](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#brand), which brands a column by its table and column by default and takes a token for a brand that columns share.
[orchid-orm#734](https://github.com/romeerez/orchid-orm/issues/734) also proposes inheriting the brand through a foreign key, which that documentation does not state.

Preliminary decisions:

- A brand exists only in types: it changes neither SQL nor runtime values.
- A brand also covers inputs, such as of `find`, `findBy`, `where`, `matches`, operators, `insert`, and `update`: `EqValue` reads `Operand<Output, Input>`, so a brand of the result alone still accepts an identifier of another column.
- Conditions stay structural, without a table of their own, so that one condition can apply to several tables:
  - A branded column rejects a condition of another table, such as `const condition: WhereCondition<typeof form> = { id }` in `db.field.where(condition)`.
  - Columns of one brand or without a brand do not, such as `{ active: true, tenantId }` of a parent table in `where` of its child.
  - The type of a condition of a table keeps its other columns as optional keys, so a condition of `form` with `{ published: true }` is rejected by a table whose `id` has another brand; a condition shared on purpose needs a narrow type, such as `{ published?: boolean }`.
- Relations do not inherit a brand: they belong to schemas, and the types of columns belong to tables.

Open questions:

- What identifies a brand, and how a primary key and its foreign keys share one.
- How a table shared by several schemas behaves.
- How users get a branded value from external input without a promise of runtime validation.
- How a brand passes through `nullable`, arrays, `transform`, expressions, subqueries, and `returning`.
- What brands cost to type-check, and how they appear in public declarations.
