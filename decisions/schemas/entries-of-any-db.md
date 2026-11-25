# Entries of `AnyDb`

`AnyDb` describes the operations available on every bound schema.
Its `$schema` has the type `AnySchema`, which exposes table and sequence descriptors in separate maps.
Code that needs a bound entry can take a `DbOf` for a schema that declares it.

A string index signature would make it convenient to enumerate bound entries, but an own key outside the reserved `$` prefix can name either a table query or a sequence reference.
Even a union of those two types would omit the `$` members that an arbitrary string can name.
Checking which descriptor map contains a key identifies the kind at runtime, but TypeScript does not carry that check over to the same key on a different object.

The [first-use benchmarks](../../benchmarks/types/first-use.bench.ts) measured 569 fewer instantiations for a `DbOf` assignment with either 2 or 12 tables, and 19 more for the first unbound query and the first query of a deep relation graph.
The two [SQL builder benchmarks](../../benchmarks/types/builder.bench.ts) with columns chosen at runtime measured 9 more instantiations each.
The other 100 benchmarks measured the same counts.
