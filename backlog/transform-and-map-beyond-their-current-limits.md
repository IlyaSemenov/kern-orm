# `transform` and `map` beyond their current limits

[`transform` and `map`](../architecture/queries.md#converting-results) leave out what no use has needed yet:

- A query of `$select` and a query of SQL text have no such methods, such as to define one unbound `$select` that gives a converted value; a bound one can convert its result after `await`.
- `count`, `exists`, `get`, and `pluck` reject a query of `map`, though they replace the fields that its callback reads, so they could drop the conversion, such as to count the rows of a query that a helper of `map` defines.
- The callback of `orderBy` after `map` has no selected fields, and could read those that `map` receives, which the state would need to keep.
- `where`, `orderBy`, `limit`, and `offset` could apply after `transform` where they keep what its callback receives, such as on a query whose row no relation guarantees.
- Types accept `map` without `select` in a helper, which [`use` of a mutation](../architecture/mutations.md#helpers) rejects at runtime on a mutation without earlier selected fields, since the state does not keep the fields before `map`.
