# Workspaces

How to add workspace packages and subpath exports, and how to declare the dependencies of packages.

## Packages

- Name a workspace directory by the responsibility of its package rather than by its npm name, such as `packages/db` for `kern-db`.
- Register every workspace package and its subpath exports in `paths` of the root `tsconfig.json`; tests, examples, and typecheck resolve packages to their sources through it.
- Link `kern-db` for the ranges of the packages that require it through `overrides` of the root `package.json`: Bun links a workspace package for a plain range only when its version satisfies the range, and otherwise fetches the range from the registry, such as before the first release of a package.

## Dependencies

- Declare the dependency of a published package on another package of the repository by a range of one minor line, such as `^0.1.0`, under the contract in [architecture/compatibility.md](../architecture/compatibility.md).
  - Declare it in `dependencies` when the package does not work without the other, such as `kern-orm` on `kern-db`.
  - Declare it in `peerDependencies` for a companion package, which works with the objects that the application creates with the other package, such as the migrator with the database of the application, and in `devDependencies` as `workspace:*`, which links the workspace package.
  - Do not use the `workspace:` protocol in `peerDependencies` or `dependencies`: `changeset publish` publishes with npm, which does not rewrite it.
  - When a new minor version leaves the range of a dependent, changesets releases the dependent with a patch and its new range; add a changeset of the dependent when it changes for the new version.
  - When a dependent needs a newer version within its range, raise the minimum of its range by hand and add a changeset of the dependent in the same change: changesets warns that the range does not fit the local version until the release, and does not release the dependent by itself.
  - In companion packages, import from the package they depend on only types and values that behave the same with any copy of it, such as error classes, which recognize the errors of another copy by a symbol of `Symbol.for`, so that a duplicate copy cannot change runtime behavior.
    When a companion package needs runtime identity of that package, such as its transaction context, stop and reconsider how it depends on it.
    The one exception is the database that `kern-migrations` creates over a driver target, as [architecture/migrations.md](../architecture/migrations.md#targets) describes.
- Declare a workspace package used only by the tests of a published package in its `devDependencies` as `workspace:*`: package managers do not install the dev dependencies of an installed package, and changesets neither rewrites the protocol nor releases the package for it.
- Declare a registry package that several workspaces use in development, such as `postgres`, in their `devDependencies` as `"catalog:"`, with its version in `workspaces.catalog` of the root `package.json`.
  A driver for an older major version of its client declares that client by its own range instead; Bun installs it for that workspace alone, and typecheck resolves its types from there.
- Keep `typescript` at 7.1 or later: tsdown generates declarations through the API of TypeScript 7, which 7.0 does not provide.
  Pin a prerelease of `typescript` to its exact version: a caret range resolves to a nightly `-dev` build.
  Typecheck uses `bun check`.
- In scripts of `benchmarks` and `packages/orm`, call TypeScript 7 by its path: `tsc` there is TypeScript 6 of `typescript-6`, which the profiler of types patches.
