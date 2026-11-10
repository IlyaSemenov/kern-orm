# Aggregates by the type of their argument

Research: types reject an aggregate whose argument PostgreSQL cannot aggregate, such as `sum` of `text`, so that completions of the argument offer only the columns it can.

- `min` and `max` of ordered types, as `orderingOperators` give them, except `uuid`, which has no `min` and `max` in PostgreSQL; `sum` and `avg` of numbers and `interval`, such as by a capability of numeric types that arithmetic operators would bring; `every` and `some` of `boolean`; `stringAgg` of text.
- Types could also tell the type of the value of an aggregate by the type of its argument, such as a number for the average of `bigint` values, which `avg` rejects: a property of a type that `transform` drops, carried by column references and expressions.
- The [aggregate functions](../architecture/types.md#aggregate-functions) take the same argument, so the design applies to both.
- Profile the cost of each aggregate call with `bench:types` before choosing a design.
