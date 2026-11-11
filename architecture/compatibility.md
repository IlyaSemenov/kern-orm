# Package compatibility

The packages of the repository have independent versions: a release of one package releases another only when the other depends on it and the new version leaves its range.

Until 1.0, a new minor version of a package may break its contract, so a published package that depends on another package of the repository requires it by a range of one minor line, such as `^0.1.0`, which rejects `0.2.0` ([decision](../decisions/packages/database-package.md)):

- A package that does not work without the other requires it in `dependencies`, such as `kern-orm` will require `kern-db`.
- A companion package, which works with the objects that the application creates with the other package, such as the migrator with its database, requires it in `peerDependencies`, and in `devDependencies` as `workspace:*`, which links the workspace package.
- A new minor version that leaves the range of a dependent makes changesets release the dependent with a patch and its new range; a dependent that changes for the new version needs a changeset of its own.
- A dependent that needs a newer version within its range raises the minimum of its range by hand, with a changeset of its own.
- A change does not keep published versions of other packages working: a published version that a change breaks gets no fix and no deprecated alias.
- A range may widen once a pair of versions is tested together and the contract settles.

A peer dependency does not ensure one copy of a package in an application.
Only the errors of drivers and transactions recognize the errors of another copy, by brands of `Symbol.for`; other values that a module of one copy brands, such as codecs and SQL fragments, are not values of another copy.

The published packages `@kern-orm/postgres-js`, `@kern-orm/node-postgres`, and `@kern-orm/migrations` keep their ranges of the whole 0.x series of `kern-orm` until `kern-db` replaces them ([backlog](../backlog/database-layer-as-a-package.md)).

Each companion package lists what it relies on, such as [drivers](drivers.md#compatibility) and [migrations](migrations.md#compatibility).
