# Database layer as a package

The [database layer](../architecture/README.md#layers) as the package `kern-db`, so that the migrator and code without the ORM, such as a runner of jobs, use it without `kern-orm` ([decision](../decisions/packages/database-package.md)).

## Steps

1. Done: the contract of types and the built-in types of the layer, exported from `kern-orm/db` and `kern-orm/db/types`, and the type of the ORM built on them.
2. Done: queries of SQL text in the layer, with its SQL fragments and the decoding of flat results, which `query` of a `Database` and `$query` of a `Db` start, and the documentation of migrations on its fragments and types.
3. Done: the driver contract and the tests of the layer on its own API, a harness of its tests without the ORM, the check of its imports, the coordinator out of `Database`, and `bindSchema` instead of `bind` of a `Database`.
4. Done: the packages `kern-db`, `kern-orm`, and `kern-migrations`, their package test, and the documentation site grouped by package.
5. The [release](#release) of the packages.

## Release

- The first versions: `kern-db` 0.1.0 and `kern-migrations` 0.1.0, each from the version `0.0.0` of its new manifest and a `minor` changeset; `kern-orm` continues its versions, to the version that its pending changesets release.
- Release in this order:
  1. `kern-db` with its subpaths.
  2. `kern-orm` with its dependency on the published `kern-db`.
  3. `kern-migrations` with its peer range of that `kern-db`.
- Release no version of `@kern-orm/postgres-js`, `@kern-orm/node-postgres`, or `@kern-orm/migrations`; once the new packages are published, `npm deprecate` of each points to its replacement.

## Open questions

- Whether a release of `kern-orm` that moves to a new minor version of `kern-db` is a patch, as changesets releases a dependent whose range the new version leaves, or a minor, since an application that also imports `kern-db` gets two copies until it updates.
