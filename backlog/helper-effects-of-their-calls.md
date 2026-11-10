# Helper effects of their calls

Helper effects that record the calls of their callbacks rather than only the rows mode they end with, so that types check what the runtime checks and the limitations that [architecture/queries.md](../architecture/queries.md#helpers) states for helpers go away:

- a query of one row rejects a helper that calls `limit` or `offset`;
- the effect applies the calls that change the rows in their order, also in a helper that it applies, so that a helper whose last such call is `required` makes a query of one row `one` in types, as it does at runtime;
- a query of values rejects a helper that calls `nullable` before `optional` or `required`, also when the call is in a helper that it applies;
- a query with a row lock rejects a helper that calls `groupBy`;
- a conditional call of `groupBy` is recorded even when TypeScript reduces the union of its branches to the ungrouped one, so queries made by an aggregate, `exists`, or `map` reject it too.

It needs a new part of the query state, so measure its cost with `bench:types` before choosing a design.
