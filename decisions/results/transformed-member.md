# The `transformed` member of a query of `transform`

A query of `transform` has the type-only member `transformed`, which `SelectQuery` lacks, so that TypeScript rejects a query of a table as a query of `transform` by the missing member rather than by comparing their states.

- Without it, the first unbound query that a consumer executes takes about 3.7% more instantiations, and the first query of a deep relation graph about 5.4% more ([benchmark](../../benchmarks/types/first-use.bench.ts)).
