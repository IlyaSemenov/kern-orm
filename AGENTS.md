# kern-orm Agent Guide

## Overview

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

Read [README.md](README.md) completely before changing the public API, package behavior, supported runtimes, or user documentation.
Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing the AST, compiler, schemas, or transaction routing, and keep it in sync with the code.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas.
Do not catalog files or restate information evident from their names and locations.

## Release status

The packages are at version 0.0.0 and have no users; remove this section with the initial release.

- Judge a change only by the contract it produces.
  Do not compare behavior with previous revisions, call changes breaking, or add compatibility paths, migration notes, or deprecations.
- Do not add changesets: the pending initial release covers every change.
- Track pending work in [PLAN.md](PLAN.md): add an item without a number, and delete it once it is done, moving its lasting contracts to [ARCHITECTURE.md](ARCHITECTURE.md).

## Scope

- Keep publishable packages in `packages/`, private usage examples in `examples/`, and benchmarks in `benchmarks/`.
- Keep production code in `packages/*/src/`.
- Name a directory of one concept in the singular, such as `expression/`, and a directory of like items in the plural, such as `builtins/`.
- Keep focused module tests beside their source: `foo.test.ts` and `foo.type-test.ts` test `foo.ts`.
- Test each behavior at the lowest level that can check it: a helper directly, a module that combines helpers by its own unit tests.
- Keep integration and package-boundary tests, with fixtures of their own, in `packages/*/tests/`, importing packages by name.
- Keep the test harness shared by the tests of a package in `packages/*/testing/`, importing packages by name.
  Keep a test helper that builds or reads internals beside them in `src/<module>/testing.ts`, such as `src/ast/testing.ts`, so that nothing outside `src/` imports from `src/`.
- Use `examples/` as acceptance tests of the public API in realistic multi-schema setups.
- Name runtime tests `*.test.ts`, compile-only type tests `*.type-test.ts`, and tests of the packed packages `*.package-test.ts`.
- Structure type tests with `describe` and `test` from `bun:test`, like runtime tests; `bun test` does not run them, and typecheck checks their bodies.
- Keep each package entry point, `src/index.ts` and one `src/<name>.ts` per subpath export, limited to explicit public exports.
- Export from an entry point every type that the inferred types of public values reference, so that the declarations of a consumer module can name them; the package test emits such declarations.
- Treat `package.json` exports and supported runtimes as public contracts.

## Runtimes

- Support only Node.js and Bun versions maintained by their projects.
- Prefer DX over older runtimes: when a newer runtime version enables a simpler or safer API, raise the minimum version instead of working around older ones.
- Declare the minimum versions in `engines` of every published package and in the install section of `docs/getting-started.md`.
- Pin the PostgreSQL major version of the CI service and state it in the install section of `docs/getting-started.md`.

## Workspaces

- Register every workspace package and its subpath exports in `paths` of the root `tsconfig.json`; tests, examples, and typecheck resolve packages to their sources through it.
- Declare a dependency of a published package on another workspace package in `dependencies` as a caret range that matches the local version, such as `"kern-orm": "^0.0.0"`; Bun links the workspace package, and changesets raises the range on release.
  - Do not use the `workspace:` protocol there: `changeset publish` publishes with npm, which does not rewrite it.
  - Do not declare workspace packages in `peerDependencies`: changesets releases a major version of the dependent whenever the peer range falls behind.
  - In other published packages, import only types from `kern-orm`, so that a duplicate copy of `kern-orm` cannot change runtime behavior.
    When a package needs runtime identity of `kern-orm`, such as its error classes, symbols, or transaction context, stop and reconsider how it depends on `kern-orm`.
- Declare a workspace package used only by the tests of a published package in its `devDependencies` as `workspace:*`, such as `@kern-orm/postgres-js` in `kern-orm`: package managers do not install the dev dependencies of an installed package, and changesets neither rewrites the protocol nor releases the package for it.
- Keep `typescript` at 7.1 or later: tsdown generates declarations through the API of TypeScript 7, which 7.0 does not provide.
  Pin a prerelease of `typescript` to its exact version: a caret range resolves to a nightly `-dev` build.
  Typecheck uses `bun check`.
- In scripts of `benchmarks`, call TypeScript 7 by its path: `tsc` there is TypeScript 6 of `typescript-6`, which the profiler of types patches.

## Design

- With every change, look for refactorings that reduce complexity: duplicated logic, a concept spread over several modules, or code that an upcoming feature will need elsewhere.
  Make those that belong to the change, and propose the others in the final report.
- Give a domain rule or contract its own function or module at its first use, such as the keys a record can have, operator precedence, or result decoding, so that the next use finds it.
  Do not extract code that only looks alike.
- Before adding a helper, search for an existing one that does the same.
- Design the API and its documentation for the common case of one `Db` imported across the application, such as `import { db } from "#db"`: code of that case must not need to refer to a schema.
  Require schemas in user code only where the code has no `Db`, such as with dependency injection or in code shared by several Dbs.

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

## Benchmarks

- Back a decision made for speed or size, such as the SQL that the compiler builds instead of an alternative, with a benchmark, and link it from the decision in [ARCHITECTURE.md](ARCHITECTURE.md).
- Write a benchmark of SQL as a script `benchmarks/suites/<topic>.ts`, such as `nested-transport.ts`, that compares the chosen variant with its alternatives through `runBenchmark` of `benchmarks/harness.ts`; its header names the variants and what it measures.
- Keep data and SQL shared by several benchmarks in a module beside the harness, such as `benchmarks/nested-rows.ts`.
- Run a benchmark with `bun run --cwd benchmarks bench <topic>`, which reads `DATABASE_URL` from `.env.test.local`.
- Generate the data of a benchmark deterministically, in SQL or from an explicit seed, inside the transaction of `runBenchmark`, which rolls back.
- Measure the type-check cost of the API with the Attest benchmarks `benchmarks/types/*.bench.ts`: `bench(...).types()` counts the instantiations that its callback adds to its file, checked against the declarations of the built packages.
  - Warm up a benchmark of a repeated call, such as a query, with a call of the same kind on other columns in `bench.baseline`, so that it counts each further call rather than the first.
  - Run them with `bun run --cwd benchmarks bench:types`, which prints the change of each count from the one written in its file, and write the measured counts with `-u`.
  - Find the types that a benchmark instantiates on each call with `bun run --cwd benchmarks profile:types types/<file> <name>`; the header of `benchmarks/types/profile.ts` describes its options.
  - Read [benchmarks/types/PROFILING.md](benchmarks/types/PROFILING.md) before measuring a cost that the benchmarks do not cover or looking for its cause.
- Do not run benchmarks in CI.
- Record in ARCHITECTURE.md the ratios that a decision relies on rather than absolute times, and rerun the benchmark to update them when a change affects what it measures.

## Documentation

- Keep user documentation in the VitePress site in `docs/`, published to GitHub Pages; keep package READMEs short and link to the site.
- Add every new page to the sidebar in `docs/.vitepress/config.ts`.
- Write every column of a `defineTable` call on its own line, even a single column, in documentation, examples, and tests.
- Write every field returned from the callback of `select`, such as an expression or a relation, on its own line, even a single field, in documentation, examples, and tests.
- In user documentation, name the `Db` `db`, the schema `schema`, and other such values by their kind, such as `database`, unless the page uses several of one kind; then name each by its role, such as `tenantDb` and `saasDb`.
- Update the affected site pages together with a change to the public API or behavior.
- Write public README and JSDoc text for package users who do not know the implementation.
- Write user documentation as a guide to using the API in plain terms: what to call and what it does, not how it is typed or implemented.
- Start each page and section of user documentation from what users want to achieve in their application, such as sharing tables between tenant and SaaS schemas, rather than from a description of the project or its concepts.
  Name only a task that users really have; when none fits, state plainly what the API does instead of inventing a task for a "To …" opening.
  Open with a short statement of the common case and its example, and put details, alternatives, and edge cases after the example.
- Other things being equal, write the happy path as an instruction of what to do, such as "Pass the values to `where`", rather than as a description of the API, such as "`where` takes values".
  This is a preference, not a rule: keep a description wherever it reads more clearly.
- Do not restate in prose what users see in their editor's types or learn from a TypeScript or runtime error.
- Mention an edge case in user documentation only when users must write different code because of it; record other edge cases, typing rules, and invariants in [ARCHITECTURE.md](ARCHITECTURE.md) and cover them with tests.
- Write a rule that users must follow as an instruction, such as to include each table under one key, rather than as the check or error that enforces it.
- Keep material for authors of extensions, such as custom types and operators, on Advanced pages, separate from the guides for using the API.
- When a change makes an existing statement false, fix that statement rather than add an explanation next to it.
- Add JSDoc to every exported declaration and to internal helpers whose contract, inputs, output, or failure behavior is not obvious.
- Add inline comments beside every non-obvious invariant, algorithmic choice, safety constraint, and intentionally limited behavior.
- Update nearby JSDoc and inline comments whenever the documented code changes, and remove comments that no longer apply.
- Do not narrate self-evident syntax or restate what a name already communicates.
- Do not document obvious or implied defaults.
- Describe a default only when readers need it to make a decision or avoid surprising behavior.
- Use One Sentence Per Line for connected prose.
- Keep semantically connected explanations as prose paragraphs.
- Use lists for separate assertions instead of presenting them as prose paragraphs.

## Changesets

- Add one `.changeset/*.md` file for each independently releasable user-visible change.
- Do not add changesets for internal refactors, maintenance, tests, or documentation changes that do not require a package release.
- Choose the SemVer bump from the public contract: `patch` for backward-compatible fixes and `minor` for backward-compatible functionality.
- Before 1.0, use `minor` for breaking changes; starting with 1.0, use `major` and remove this rule.
- Create `.changeset/<unique-name>.md` with this format, listing every affected package:

```markdown
---
"kern-orm": patch
---

Describe the user-visible change.
```

- Briefly describe the user-observable change or new capability in the public contract, without implementation details or rationale.
  Prefer a single sentence.
- For a fix, describe the problem users saw, not how the fix works:
  - Avoid: "Compare cache keys by the normalized path instead of the raw argument."
  - Prefer: "Fix stale results when the same file is passed through different relative paths."
- Do not edit package versions or `CHANGELOG.md` by hand, and do not run `changeset version` or `changeset publish`; the maintainer releases pending changesets by hand.

## Tests

- Add a `describe` block where the file gives a reason for it: several APIs or behaviors in one file, or a fixture that belongs to some cases but not all.
  Name such a block after what it covers and keep its fixtures inside it.
- Distinguish several same-kind values by role rather than by order.
  When values differ only by order, number them with digits instead of ordinal words.
- Keep tests deterministic so a failure repeats on every run.
  Generate random inputs from an explicit seed and print the seed in failure messages so the failing input can be replayed.
- Test SQL generation and transaction routing without a database through the recording driver in `packages/kern-orm/testing/`.
- Skip tests that need PostgreSQL when `DATABASE_URL` is not set; CI provides it.
  Locally, it points to an empty database, set in `.env.test.local` copied from `.env.test.local.example`, which `bun test` loads instead of `.env.local`.
  In `kern-orm`, declare them with `describePostgres` of `packages/kern-orm/testing/postgres.ts`, which skips them and gives them a database created with `test: true`.
- Leave the test database unchanged: create tables and data in `testTransaction` or in the seed of a test fixture of a database created with `test: true`, and close every fixture the test opens.
  Do not start a separate PostgreSQL cluster.
- Test concurrent transactions through connection-level state, such as `pg_backend_pid()` and transaction-local settings from `set_config(..., true)`, rather than committed tables.

## Checks

- Run the `types` script when public types or TypeScript configuration change.
- When a change touches generic types that user code instantiates on every call, such as the signatures and states of query methods, column references, or table and type definitions, run the `bench:types` script of `benchmarks`, report the change of every count in percent, and write the new counts with `-u` in the same change.
  Warn when the growth is substantial, such as when existing queries become more expensive to type-check.
- Run the `test` script when behavior changes.
- Run the `test:package` script when package exports, declarations, build configuration, `engines`, or module-level code change; it builds the packages first.
- Run the `docs:build` script when site pages or the VitePress configuration change.
