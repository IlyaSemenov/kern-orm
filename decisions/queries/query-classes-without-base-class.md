# Query classes without a base class

The classes of queries share no base class, so each declares `types`, `db`, `then`, and `toSQL`.

- A probe of a base class of these members saved about 55 lines, and added 0.5% to 4% to 57 of the 60 benchmarks of types, such as 1.2% to the first unbound query and 1.7% to a query of a deep relation graph ([first query](../../benchmarks/types/first-use.bench.ts), [further queries](../../benchmarks/types/queries.bench.ts)), and about 2.5% on Bun 1.4.4 and 7% on Node.js 24.18 to a chain of clauses, each of which derives a query ([benchmark](../../benchmarks/runtime/building.bench.ts)).
