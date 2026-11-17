# An increment as an operator

An increment of a column is `add` in the callback of `update`, without a method of a mutation of its own.

```ts
// Chosen
await db.form.find(formId).update(form => ({
  viewCount: form.viewCount.add(1),
}))

// Alternative: a method of a mutation
await db.form.find(formId).increment("viewCount")
```

- A method is shorter for the common case of one column and a step of `1`, and needs no callback.
- The operator takes any operand, such as another column or a query of one value, and works in `update` of `onConflict` and in any expression, where a method of a mutation does not reach; a method would duplicate it with a form of its own for each of these cases.
  The same `update` sets the other columns too.
- Orchid ORM has `increment` and `decrement` of a query, which take a column, or an object of columns and their steps ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#increment)).
- Prisma ORM has `increment`, `decrement`, `multiply`, and `divide` as values of a column in `update`, only of number fields, and only one of them for each field ([docs](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#atomic-number-operations)).
