# One parameter of `$execute` for every class of query

`$execute` and `$compile` of a `Db` take a query of a table, a query of `$select`, a query of `transform`, and a mutation by one parameter constrained by a union of the four classes rather than by overloads.

- With overloads, a call that matches none reports the errors of the last overload, which would name another class.
- The query of `$select` in the union adds about 6% to the instantiations of the first unbound query that a consumer executes and up to 1.5% to each further one, and the mutation about 0.3% to each ([first query](../../benchmarks/types/first-use.bench.ts), [further queries](../../benchmarks/types/queries.bench.ts)).
