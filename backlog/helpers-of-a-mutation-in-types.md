# Helpers of a mutation in types

[`use` of a mutation](../architecture/mutations.md#helpers) rejects at runtime some of what types accept, and a helper applies to a mutation only with `use`, not as a function of a query:

- Types accept a helper that calls `groupBy`, `orderBy`, `limit`, or `offset`, which a mutation lacks; the effect records only guaranteed grouping, which `use` of a mutation does not check.
- Types do not tell a selection of no fields from none, which needs a new part of the state or of the marker of a helper, and each query would pay for it.
