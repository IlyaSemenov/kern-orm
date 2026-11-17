# Orchid transaction interoperability

`@kern-orm/orchid-interop` supports shared queries and callback transactions through either ORM, nested savepoints, recoverable queries, transaction detection, and Kern's test helpers.
Its [architecture](../architecture/orchid-interop.md) defines the supported versions and boundaries.
Migrations and table-definition generation are separate work.

## Application acceptance

Connect the adapter to one existing application and convert a small service function to a Kern singleton.
Exercise that function inside both Orchid-owned API calls and Kern transaction calls.
Inventory the application's use of the explicitly unsupported features before expanding its supported scope.

Extend the acceptance cases for the actual application's relation graphs, nested writes, dynamic tenant schemas, and schema/log scopes.
Check timed-out tests and late callbacks against the migrated application harness; keep Kern as its transaction owner.

## After-commit hooks

Implement [after-commit hooks](after-commit-hooks.md) in Kern before bridging Orchid hooks.
A hook registered through Orchid inside a Kern transaction must wait for the outermost commit; rolling back its savepoint must discard it.
The public `Database` has no hook-registration operation or transaction lifecycle observer.
The adapter rejects standalone and table-declared commit hooks until that bridge exists.

## Local failures

Decide how caught local result-decoding failures should mark the owning transaction for rollback.
They currently roll back when propagated out of the callback, as application hook errors do.
Serialization failures conservatively prevent commit, also in a recoverable query; decide whether its nested transaction could recover from them without weakening that guarantee.

## Options and codec metadata

Add the transaction options an application needs, including `readOnly`, `deferrable`, and scoped `role` / `setConfig`, with restoration after nested transactions.
Unsupported options must continue to reject before running the callback or executing a query.

Add a way to refresh database-defined codecs on the Kern execution path for types created after startup, including inside a transaction.
The factory initializes one client's registries against the same pool, but does not refresh them.

Only postgres.js is in scope.

## Large results

If large reads limit an application using the adapter, benchmark letting postgres.js decode its Orchid queries directly while Kern continues to return text for ordinary queries.
The [benchmark](../benchmarks/suites/orchid-interop.md) measures the headroom and compares fusing text conversion with letting postgres.js build Orchid rows directly.
Specify how the path preserves pooled and reserved routing, error classification, codec metadata, and the adapter's object and array result semantics before expanding the driver contract.

## Legacy test harness

The adapter requires Kern's test helpers and rejects Orchid's `testTransaction` before its callback installs an independent fallback.
Decide from application migration experience whether delegating the old helper to Kern would justify another version-specific bridge.
An independent fallback must never let late work enter another test or escape to the pool.
