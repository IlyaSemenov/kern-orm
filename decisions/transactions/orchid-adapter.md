# Orchid transactions as a facade over Kern

The Orchid adapter routes every statement and callback transaction through the supplied Kern database.
It projects transaction presence into Orchid's instance-local storage and replaces `ensureTransaction` and transaction detection on the instance's query bases.
Kern retains ownership of savepoints, connection lifetimes, and test levels.
The bridge uses Orchid implementation details and rejects features whose semantics it cannot preserve.

Using Orchid's `AdapterClass` with a replacement native transport would reuse its options, hook queues, and transaction state management.
That state management also decides when a transaction begins or commits; it cannot independently observe the lifetime of a transaction opened through Kern.
Exposing a raw client would let Orchid execute outside Kern's lifetime and nested-level checks.

The per-instance bridge gives up automatic compatibility with changes to Orchid internals in exchange for one transaction owner and an unchanged Kern coordinator contract.
The peer dependencies accept later releases of Orchid ORM 1 and postgres.js 4 rather than pin the tested versions: an exact pin would keep an application from a release of Orchid whose internals break the bridge, but would also hold every application at one release until the adapter is released again.
Neither the adapter nor CI checks a later release: the adapter does not verify the internals it relies on when it starts, and CI tests only the pinned versions, so a change to the transaction internals of Orchid may break the bridge silently, such as by running a query of a transaction outside of it; the range accepts that risk.
It does not modify global Orchid prototypes, so native Orchid instances remain independent.
After-commit support requires explicit integration with Kern rather than independent Orchid bookkeeping.
Query recovery runs the query in a nested Kern transaction rather than in Orchid's savepoint protocol; a recoverable write of `.none()`, which bypasses the `then` accessor of the bridge, runs only its statement in one, as Orchid runs it in a savepoint.
