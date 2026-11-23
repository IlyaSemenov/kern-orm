# Cost of deriving query nodes

Every method that derives a query copies the fields of its node by spread and freezes the copy, in `derive` of `SelectQuery` and `MutationQuery` and in the queries of `transform`.
The copy is shallow, so its cost grows with the number of fields of the node rather than with the query, whose filters, projections, and expressions the copy shares.
Change it only if a CPU profile of the runtime benchmarks `building` and `preparation` on Bun and Node.js shows that the copies and the freezes take a substantial share of building and compiling a query.

- First compare a checkout that keeps the copies and drops only the freeze of the node, with `--base`; frozen nodes are a contract of [query objects](../architecture/queries.md#query-objects), so dropping it needs a decision of its own, as for [arrays of nodes](../decisions/queries/unfrozen-node-arrays.md).
- A node of a parent and its changes, flattened before lowering, would replace the copy with a small record, but needs a cache of the flattened node and a bound on the depth of chains, and changes what the `node` of a query holds, which lowering reads field by field.
- A node that inherits from the node it derives from by its prototype does not fit: assigning a field inherited from a frozen node throws, deep chains slow down every read of lowering, and spread and `Object.keys` miss the inherited fields.
- A mutable builder does not fit: queries derived from a shared base must stay independent.
- Keep the reset of `foundKey` in every select query derived from a query of [`find` and `findBy`](../architecture/queries.md#finding-by-a-key): it rejects `upsert` at runtime after a method that changes the query.
- Profile first the work around the derivation that grows with the query, such as building filters and projections, lowering, and compiling.

Unchecked leads, to verify before relying on them:

- A synthetic benchmark of deriving an object of 20 fields on Node.js 22.16, outside kern-orm, measured a median of about 345 ns for spread and freeze, 315 ns for spread without freeze, 863 ns for a prototype with the changes and freeze, and 1,436 ns for `Object.assign` and freeze.
- Kysely is said to copy its operation nodes by spread and freeze them, also their arrays; check it in its sources and record it in [comparison/](../comparison/README.md).
