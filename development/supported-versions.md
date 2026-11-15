# Supported versions

How to change the supported versions of PostgreSQL, Node.js, Bun, and TypeScript.

## PostgreSQL

- Pin the PostgreSQL major version of the CI service and state it in the install section of the Getting Started page of each package, such as [docs/orm/getting-started.md](../docs/orm/getting-started.md).
- When raising it, regenerate `packages/db/src/error-condition-codes.ts` from `src/backend/utils/errcodes.txt` of that version, as its header describes.

## Runtimes

- Support only Node.js and Bun versions maintained by their projects.
- Prefer DX over older runtimes: when a newer runtime version enables a simpler or safer API, raise the minimum version instead of working around older ones.
- Declare the minimum versions in `engines` of every published package and in the install section of the Getting Started page of each package.
- Test both runtimes in CI, at the versions pinned in `mise.toml`, against its PostgreSQL service: the `test` script on Bun, the `test:node` script on Node.js, and the `test:package` script, which also runs the scenarios of `node:test` and Vitest.
- Support TypeScript 6.0 or newer with `strictNullChecks` in consumer projects, and state it in the install section of the Getting Started page of each package.
  The package test type-checks its consumer with both the pinned `typescript` and the minimum version, `typescript-6` in `devDependencies` of `kern-orm`, and the `types:ts6` script type-checks the repository with the minimum version.
