# kern-orm Agent Guide

## Overview

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

Before changing the public API, package behavior, supported runtimes, or user documentation, read the pages of the user documentation in [docs/](docs/) that the change affects.

Before changing a module, read [architecture/README.md](architecture/README.md) and the files that its map lists for the module, and keep them in sync with the code.
Keep [architecture/](architecture/README.md) to the code as it is: record a contract in the file of its topic and unresolved design of the code in its Open questions; list a new file in the map.
In architecture/, state what users must do as a requirement of the contract, such as "must be split" or "requires a key", rather than as a description of what users do, such as "users split".

Record a decision in [decisions/](decisions/README.md) when an alternative has a real advantage that the chosen design gives up, such as in DX, speed, or size, or looks better than it measures, so that it would be proposed again, including a choice of implementation, such as how a function recognizes its argument; keep a choice without such an alternative in architecture/ as its contract with a reason of one clause.
Whenever you learn how another ORM, query builder, or migrator handles a scenario of kern-orm, such as from its issues, documentation, or sources, or while researching a design, record it in [comparison/](comparison/README.md).
Track work not done yet in [backlog/](backlog/README.md).
Follow the rules of the index of each of them.

Read the relevant guide in [development/](development/README.md) before starting:

- [testing.md](development/testing.md) before writing, changing, or running tests;
- [benchmarks.md](development/benchmarks.md) before writing, changing, or running benchmarks;
- [user-documentation.md](development/user-documentation.md) before changing `docs/` or a README;
- [workspaces.md](development/workspaces.md) before adding a workspace package or a subpath export, or changing the dependencies of a package;
- [supported-versions.md](development/supported-versions.md) before changing the supported versions of PostgreSQL, Node.js, Bun, or TypeScript.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas that most changes need; put those of one topic in the guide or the index of that topic.
Do not catalog files or restate information evident from their names and locations.

## Scope

- Keep publishable packages in `packages/`, private usage examples in `examples/`, benchmarks in `benchmarks/`, and the test harness that the tests of several packages share in `testing/`.
- Keep production code in `packages/*/src/`, and place tests as [development/testing.md](development/testing.md) describes.
- Name a directory of one concept in the singular, such as `expression/`, and a directory of like items in the plural, such as `builtins/`.
- Keep each package entry point, `src/index.ts` for `.` and `src/<subpath>.ts` for each subpath export, such as `src/db.ts` for `./db` and `src/db/types.ts` for `./db/types`, limited to explicit public exports.
- Keep `index.ts` only as the root entry point: a directory inside `src/` has none, each module is imported by its own path, and only package entry points re-export.
- Export from each entry point the types that the inferred types of its values reference, also from an entry point of values such as `kern-orm/types`, so that a consumer module that imports only that entry point can emit its declarations: TypeScript names a type only through a module that the program loads and that the consumer resolves.
  The package test emits the declarations of a module of each entry point of values in a program of its own, and of a consumer that cannot resolve `kern-db`.
- Keep `kern-db` independent of the other packages of the repository: no file of `packages/db` imports another package of the repository, also for types, except that its tests and the test helpers of its modules import the test harness; no workspace imports a module of another workspace by a relative path; and the other workspaces import `kern-db` only through its entry points; `packages/db/tests/boundaries.test.ts` checks all three.
- Treat `package.json` exports and supported runtimes as public contracts.

## Design

- With every change, look for refactorings that reduce the complexity of the code it touches, such as duplicated logic or a concept spread over several modules.
  Make those that ease the change, and propose the others in the final report, listed apart from its fixes.
  Do not reshape existing code for a feature of the backlog before its work starts.
  When a change introduces a concept that a feature of the backlog will extend, such as a node kind or an operator set, name and shape it for that feature too.
- Give a domain rule or contract a function of its own at its first use, such as the keys a record can have, operator precedence, or result decoding, so that the next use finds it; give it a module of its own only when several modules use it.
  Do not extract code that only looks alike.
- Before adding a helper, search for an existing one that does the same.
- Check a call or a value that types reject against an interface whose only property is named after the reason, such as `NotAKey`, rather than against `never`, so that the error tells the reason.
  Give the property the details that users need to fix the call, such as the keys of the table, or `never` when there are none.
- Design the API and its documentation for the common case of one `Db` imported across the application, such as `import { db } from "#db"`: code of that case must not need to refer to a schema.
  Require schemas in user code only where the code has no `Db`, such as in code shared by several Dbs.

## Refactoring

- When moving or splitting code, move its tests to follow it.

## Performance

- Treat code that runs per query, per parameter, or per row as a hot path: query building, compilation, parameter encoding, statement routing, and result decoding.
- In a hot path, avoid allocations and iterations that readability and safety do not need:
  - build arrays and objects with loops, `push`, and assignment instead of chains of `map`, `filter`, `Object.entries`, and `Object.fromEntries`;
  - assign the fields of a new object instead of spreading another object into it;
  - avoid rest and array destructuring, which copy or iterate;
  - searching an array with `findIndex`, `find`, or `some` is fine.
- Keep copying a node when a query derives a new one: queries and nodes are shared and immutable, so this copy is required.
- Mark a module-level call in production code that only creates a value, such as a type definition, with `/* @__PURE__ */`, including calls in its arguments, so that bundlers of consumers drop the definitions they do not use.

## Code style

- Write every column of a `defineTable` call on its own line, even a single column, in documentation, examples, and tests.
- Write every field returned from the callback of `select`, such as an expression or a relation, on its own line, even a single field, in documentation, examples, and tests.

## Documentation

- Update the affected site pages together with a change to the public API or behavior.
- Write public documentation and JSDoc text for package users who do not know the implementation.
- When a change makes an existing statement false, fix that statement rather than add an explanation next to it.
- Add JSDoc to every exported declaration and to internal helpers whose contract, inputs, output, or failure behavior is not obvious.
- Add inline comments beside every non-obvious invariant, algorithmic choice, safety constraint, and intentionally limited behavior.
- Update nearby JSDoc and inline comments whenever the documented code changes, and remove comments that no longer apply.
- Do not narrate self-evident syntax or restate what a name already communicates.
- Describe a default only when readers need it to make a decision or avoid surprising behavior.
- Use One Sentence Per Line for connected prose, including JSDoc and code comments: do not wrap a sentence across lines.
- Keep semantically connected explanations as prose paragraphs, and use lists for separate assertions.
- Link a file of another repository by a tag or a commit, such as of the version you checked, never by a branch such as `main`, whose file changes.

## Changesets

- Add changesets as [.changeset/README.md](.changeset/README.md) describes.

## Tests

- Tests that need PostgreSQL run only when `DATABASE_URL` is set; CI provides it.
  Locally, set it in `.env.test.local`, copied from `.env.test.local.example`, to an empty database, connecting as a superuser to a server with the pgvector extension installed; `bun test` and the Vitest config load it instead of `.env.local`.

## Checks

- Run the `types` and `types:ts6` scripts when public types or TypeScript configuration change.
- When a change touches generic types that user code instantiates on every call, such as the signatures and states of query methods, column references, or table and type definitions, run the `bench:types` script of `benchmarks`, report the change of every count in percent, and write the new counts with `-u` in the same change.
  Warn when the growth is substantial, such as when existing queries become more expensive to type-check.
- Run the `test` and `test:node` scripts when behavior changes.
- Run the `test:package` script when package exports, declarations, build configuration, `engines`, or module-level code change, or when transactions or test helpers change; it builds the packages first.
- Run the `docs:build` script when site pages, the VitePress configuration, or links in the READMEs, `AGENTS.md`, or the project documentation, such as `architecture/`, change.
