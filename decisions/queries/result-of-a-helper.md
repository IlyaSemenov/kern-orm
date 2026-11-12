# `ResultOf` of a helper

`ResultOf` takes a helper of `defineHelper` besides a query, and gives the record of the fields that the helper selects, or what its `map` gives, such as `ResultOf<typeof selectSummary>`.

- A type of its own, such as `FieldsOf<typeof selectSummary>`, would tell by its name that the record has only the fields of the helper, not those of a query it is applied to; `ResultOf` gives one name for the type of a record of a query and of a helper.
- `ResultOf<ReturnType<typeof selectSummary>>`, which needs no change, reads the query that the helper returns for the constraint of its input, and does not tell whether it gives a record or an array.
- `ResultOf` of a query becomes a conditional type; generic code over a query constrained by a query class, such as `AnySelectQuery`, type-checks with it as with an indexed access.
