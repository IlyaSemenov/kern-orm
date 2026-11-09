# kern-orm Agent Guide

## Overview

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

Read [README.md](README.md) completely before changing the public API, package behavior, supported runtimes, or user documentation.

Before changing a module, read [architecture/README.md](architecture/README.md) and the files that its map lists for the module, and keep them in sync with the code.
Keep [architecture/](architecture/README.md) to the code as it is: record a contract in the file of its topic and unresolved design of the code in its Open questions; list a new file in the map.
Record a trade-off between designs in [decisions/](decisions/README.md), as [Decisions](#decisions) describes, and how other projects handle the scenarios of kern-orm in [comparison/](comparison/README.md), as [Comparison with other projects](#comparison-with-other-projects) describes.

Track work not done yet in [BACKLOG.md](BACKLOG.md), with its preliminary decisions and open questions, roughly from the most important.
Add each item as a section without a number where its importance roughly fits, and delete it once it is done, moving its lasting contracts to [architecture/](architecture/README.md), or once it is decided against, moving the decision to [decisions/](decisions/README.md).
The order is a loose hint: do not reorder other items to place a new one exactly.

Extend this guide only with stable, non-obvious conventions, architecture, contracts, workflows, and gotchas.
Do not catalog files or restate information evident from their names and locations.

## Scope

- Keep publishable packages in `packages/`, private usage examples in `examples/`, and benchmarks in `benchmarks/`.
- Keep production code in `packages/*/src/`.
- Name a directory of one concept in the singular, such as `expression/`, and a directory of like items in the plural, such as `builtins/`.
- Keep focused module tests beside their source: `foo.test.ts` and `foo.type-test.ts` test `foo.ts`.
- Test each behavior at the lowest level that can check it: a helper directly, a module that combines helpers by its own unit tests.
- Keep integration and package-boundary tests, with fixtures of their own, in `packages/*/tests/`, importing packages by name.
- Keep the test harness shared by the tests of a package in `packages/*/testing/`, and that of an example in `examples/*/testing/`, importing packages by name.
  Keep a test helper that builds or reads internals beside them in `src/<module>/testing.ts`, such as `src/ast/testing.ts`, so that nothing outside `src/` imports from `src/`.
- Use `examples/` as acceptance tests of the public API in realistic multi-schema setups.
- Name runtime tests `*.test.ts`, compile-only type tests `*.type-test.ts`, and tests of the packed packages `*.package-test.ts`.
- Structure type tests with `describe` and `test` from `bun:test`, like runtime tests; `bun test` does not run them, and typecheck checks their bodies.
- Put a call that no overload accepts on one line under `@ts-expect-error`: TypeScript 6 reports it at the call, and TypeScript 7 at the argument.
- Keep each package entry point, `src/index.ts` and one `src/<name>.ts` per subpath export, limited to explicit public exports.
- Do not add an `index.ts` to a directory inside `src/`: import each module by its own path, and re-export only from package entry points.
- Export from an entry point every type that the inferred types of public values reference, so that the declarations of a consumer module can name them; the package test emits such declarations.
- Treat `package.json` exports and supported runtimes as public contracts.

## Runtimes

- Support only Node.js and Bun versions maintained by their projects.
- Prefer DX over older runtimes: when a newer runtime version enables a simpler or safer API, raise the minimum version instead of working around older ones.
- Declare the minimum versions in `engines` of every published package and in the install section of `docs/getting-started.md`.
- Pin the PostgreSQL major version of the CI service and state it in the install section of `docs/getting-started.md`.
  When raising it, regenerate `packages/kern-orm/src/execution/error-condition-codes.ts` from `src/backend/utils/errcodes.txt` of that version, as its header describes.
- Support TypeScript 6.0 or newer with `strictNullChecks` in consumer projects, and state it in the install section of `docs/getting-started.md`.
  The package test type-checks its consumer with both the pinned `typescript` and the minimum version, `typescript-6` in `devDependencies` of `kern-orm`.
- Test both runtimes in CI, at the versions pinned in `mise.toml`, against its PostgreSQL service: the `test` script on Bun, the `test:node` script on Node.js, the `test:package` script, which also runs the scenarios of `node:test` and Vitest, and the `test:compat` script, which installs the companion packages with versions of `kern-orm` from npm.

## Workspaces

- Register every workspace package and its subpath exports in `paths` of the root `tsconfig.json`; tests, examples, and typecheck resolve packages to their sources through it.
- Declare the dependency of a companion package, a published package that works with `kern-orm`, on `kern-orm` in `peerDependencies`, so that an application has one copy of it, and in `devDependencies` as `workspace:*`, which links the workspace package.
  - Give it a range of the whole 0.x series, such as `>=0.2.0 <1`, under the contract in [architecture/compatibility.md](architecture/compatibility.md).
    List each companion package in `companionPackages` of the compatibility test, `packages/kern-orm/tests/package/compatibility.package-test.ts`, with a consumer of it in `fixtures/companion-consumers/`.
  - Do not use the `workspace:` protocol in `peerDependencies` or `dependencies`: `changeset publish` publishes with npm, which does not rewrite it.
  - Changesets keeps a peer range that contains the new version, by `onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json`.
    When a companion package needs a fix from a new patch version of `kern-orm`, raise the minimum of its range by hand and add a changeset of the package in the same change: changesets warns that the range does not fit the local version until the release, and does not release the package by itself.
  - In companion packages, import from `kern-orm` only types and values that behave the same with any copy of `kern-orm`, such as its error classes, which recognize the errors of another copy by a symbol of `Symbol.for`, so that a duplicate copy of `kern-orm` cannot change runtime behavior.
    When a companion package needs runtime identity of `kern-orm`, such as its transaction context, stop and reconsider how it depends on `kern-orm`.
- Declare a workspace package used only by the tests of a published package in its `devDependencies` as `workspace:*`, such as `@kern-orm/postgres-js` in `kern-orm`: package managers do not install the dev dependencies of an installed package, and changesets neither rewrites the protocol nor releases the package for it.
- Declare a registry package that several workspaces use in development, such as `postgres`, in their `devDependencies` as `"catalog:"`, with its version in `workspaces.catalog` of the root `package.json`.
  A driver for an older major version of its client, such as `@kern-orm/postgres-js-v3`, declares that client by its own range instead; Bun installs it for that workspace alone, and typecheck resolves its types from there.
- Keep `typescript` at 7.1 or later: tsdown generates declarations through the API of TypeScript 7, which 7.0 does not provide.
  Pin a prerelease of `typescript` to its exact version: a caret range resolves to a nightly `-dev` build.
  Typecheck uses `bun check`.
- In scripts of `benchmarks` and `packages/kern-orm`, call TypeScript 7 by its path: `tsc` there is TypeScript 6 of `typescript-6`, which the profiler of types patches.

## Design

- With every change, look for refactorings that reduce complexity: duplicated logic, a concept spread over several modules, or code that an upcoming feature will need elsewhere.
  Make those that belong to the change, and propose the others in the final report.
- Give a domain rule or contract its own function or module at its first use, such as the keys a record can have, operator precedence, or result decoding, so that the next use finds it.
  Do not extract code that only looks alike.
- Before adding a helper, search for an existing one that does the same.
- Check a call or a value that types reject against an interface whose only property is named after the reason, such as `NotAKey`, rather than against `never`, so that the error tells the reason.
  Give the property the details that users need to fix the call, such as the keys of the table, or `never` when there are none.
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

- Back a decision made for speed or size, such as the SQL that the compiler builds instead of an alternative, with a benchmark, and link it from the decision in [decisions/](decisions/README.md).
- Write a benchmark of SQL as a script `benchmarks/suites/<topic>.ts`, such as `nested-transport.ts`, that compares the chosen variant with its alternatives through `runBenchmark` of `benchmarks/harness.ts`; its header names the variants and what it measures.
- Keep data and SQL shared by several benchmarks in a module beside the harness, such as `benchmarks/nested-rows.ts`.
- Run a benchmark with `bun run --cwd benchmarks bench <topic>`, which reads `DATABASE_URL` from `.env.test.local`.
- Generate the data of a benchmark deterministically, in SQL or from an explicit seed, inside the transaction of `runBenchmark`, which rolls back.
- Write a benchmark of the time of the JavaScript of a hot path, without PostgreSQL, as a runtime benchmark `benchmarks/runtime/<topic>.bench.ts`, which mitata runs on Bun and Node.js against the built package.
  - Export from it by default a `Topic` of `benchmarks/runtime/scenario.ts`, a function of the modules of a build of `kern-orm` that returns the scenarios, and import only types from `kern-orm` in it, so that it also runs against the build of another commit.
    Write its relative imports with their `.ts` extensions, since Node.js runs it.
  - Return `unsupported(reason)` from a scenario that needs an API that the build lacks, after checking the API.
  - Measure through the public API; attribute time to an internal step with a CPU profile rather than by importing internals.
  - Run it with `bun run --cwd benchmarks bench:runtime <topic>`, and compare the current build with another commit with `--base <ref>`, such as `--base HEAD` for uncommitted changes.
  - Treat a change whose confidence interval includes no change as inconclusive, and rerun it with more pairs through `--runs` before relying on it.
- Measure the type-check cost of the API with the Attest benchmarks `benchmarks/types/*.bench.ts`: `bench(...).types()` counts the instantiations that its callback adds to its file, checked against the declarations of the built packages.
  - Warm up a benchmark of a repeated call, such as a query, with a call of the same kind on other columns in `bench.baseline`, so that it counts each further call rather than the first.
  - Run them with `bun run --cwd benchmarks bench:types`, which prints the change of each count from the one written in its file, and write the measured counts with `-u`.
  - Find the types that a benchmark instantiates on each call with `bun run --cwd benchmarks profile:types types/<file> <name>`; the header of `benchmarks/types/profile.ts` describes its options.
  - Read [benchmarks/types/PROFILING.md](benchmarks/types/PROFILING.md) before measuring a cost that the benchmarks do not cover or looking for its cause.
- Do not run benchmarks in CI.
- Record the ratios that a decision relies on rather than absolute times, and rerun the benchmark to update them when a change affects what it measures.

## Documentation

- Keep user documentation in the VitePress site in `docs/`, published to GitHub Pages; keep package READMEs short and link to the site.
- Each run of `.github/workflows/docs.yml` on `main` publishes the whole site from the current state of the repository, so run `gh workflow run docs.yml` to repair or redeploy it:
  - Release, at the root, from the commit of the last published non-prerelease GitHub Release of any package; such a release starts a run on `main`.
  - Dev, under `dev/`, from `main`, built with `DOCS_TRACK=dev`.
- Test a change of the workflow with `gh workflow run docs.yml --ref <branch>`, which builds the site of that branch without deploying it.
- Keep the build of a commit of Release in the Actions cache under `docs-release-<commit>`, which a run rebuilds when it is missing; delete it with `gh cache delete` to rebuild it on purpose.
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
- Mention an edge case in user documentation only when users must write different code because of it; record other edge cases, typing rules, and invariants in [architecture/](architecture/README.md) and cover them with tests.
- Write a rule of how users must do something as an instruction, such as to include each table under one key, rather than as the check or error that enforces it.
- State a limitation, something that users cannot do, as a description, such as "A query with `distinct` cannot select related records", rather than as an instruction to avoid it, unless the description loses clarity.
- In [architecture/](architecture/README.md), state what users must do as a requirement of the contract, such as "must be split" or "requires a key", rather than as a description of what users do, such as "users split".
- Keep material for authors of extensions, such as custom types and operators, on Extending pages, separate from the guides for using the API.
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
- Link a file of another repository by a tag or a commit, such as of the version you checked, never by a branch such as `main`, whose file changes.

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
- Name a member of a `Db` or a `Database` as users call it, such as `db.$lock()` and `database.lock()`, rather than as a member of its type.
- For a fix, describe the problem users saw, not how the fix works:
  - Avoid: "Compare cache keys by the normalized path instead of the raw argument."
  - Prefer: "Fix stale results when the same file is passed through different relative paths."
- Do not edit package versions or `CHANGELOG.md` by hand, and do not run `changeset version` or `changeset publish`; the maintainer releases pending changesets with `npx changesets-local`.

## Tests

- Add a `describe` block where the file gives a reason for it: several APIs or behaviors in one file, or a fixture that belongs to some cases but not all.
  Name such a block after what it covers and keep its fixtures inside it.
- Distinguish several same-kind values by role rather than by order.
  When values differ only by order, number them with digits instead of ordinal words.
- Keep tests deterministic so a failure repeats on every run.
  Generate random inputs from an explicit seed and print the seed in failure messages so the failing input can be replayed.
- Write runtime tests for both runners: the `test` script runs them under `bun:test`, and the `test:node` script under Vitest, which resolves `bun:test` to `vitest`.
  - Import the test API from `bun:test` and use only what Vitest also has, apart from the matchers that `vitest.setup.ts` takes from `jest-extended`, such as `toStartWith`.
    Register there by name any other matcher of `jest-extended` that a test needs, rather than all of them: some, such as `toBeOneOf` and `toBeNaN`, differ from those of Vitest.
  - Do not use the test context of Vitest, such as its `signal`: `bun:test` passes a `done` callback to a test function that declares a parameter.
  - In Bun 1.4.4, `await expect(promise).rejects` ignores the timeout of the test, so a regression that leaves the promise pending hangs `bun test`; the `test:node` script fails such a test at its timeout instead.
- Test how the test helpers work with a test runner, such as with its timeouts, hooks, and abort signal, by running the runner in a subprocess with a timeout and checking the outcome of each test and the recorded statements: `bun:test` in `packages/kern-orm/tests/test-runner.test.ts`, and `node:test` and Vitest against the packed packages in the package test.
- Test SQL generation and transaction routing without a database through the recording driver in `packages/kern-orm/testing/`.
- Test the contract of a driver with `describeDriverContract` of `kern-orm/testing`, which `tests/driver.test.ts` of every driver package calls, skipping it when `DATABASE_URL` is not set; keep in that file only the tests of what its client alone does.
  Write the tests of the contract with `node:assert/strict` and only the functions of `DriverContractRunner`: users run them with any supported test runner.
- Skip tests that need PostgreSQL when `DATABASE_URL` is not set; CI provides it.
  Locally, it points to an empty database, set in `.env.test.local` copied from `.env.test.local.example`, which `bun test` and the Vitest config load instead of `.env.local`.
  In `kern-orm`, declare them with `describePostgres` of `packages/kern-orm/testing/postgres.ts`, which skips them and gives them a database created with `test: true`.
  In `examples/forms`, declare them with `describePostgres` of `examples/forms/testing/postgres.ts`, which also creates the SaaS and the sample tenants in their PostgreSQL schemas.
  Declare tests that need statements outside a transaction to run on the pool, such as tests of transactions, with `describePooledPostgres` of the same file, which gives them a database without `test: true`.
- Leave the test database unchanged: create tables and data in `testTransaction` or in the seed of a test fixture of a database created with `test: true`, or, in a database without it, in a transaction that rolls them back or drops them, such as with `ON COMMIT DROP`, and close every fixture the test opens.
  Do not start a separate PostgreSQL cluster.
- Check a query plan by what its execution processes, such as sequential scans, rows read, runs of subqueries, and buffer blocks, rather than by a snapshot of the plan.
  Keep each table of its data within 30000 rows and the statistics target at its default, so that ANALYZE reads every row.
- Test concurrent transactions through connection-level state, such as `pg_backend_pid()` and transaction-local settings from `set_config(..., true)`, rather than committed tables.

## Decisions

- Record a decision when an alternative has a real advantage that the chosen design gives up, such as in DX, speed, or size, or looks better than it measures, so that it would be proposed again; this includes a choice of implementation, such as how a function recognizes its argument.
- Keep a choice without such an alternative in architecture/ as its contract with a reason of one clause.
- Write each decision in a file of its own under its topic directory, such as `decisions/nested-rows/`, and list it in that topic's section of the index; add a topic only when none fits.
- Write in it the chosen design, the alternatives it weighs, their measured costs, and the other projects that chose an alternative.
- Add readable code examples where they make the designs easier to compare, such as the calls that users write or the SQL that the compiler builds.
- Link a decision from the contract of its design in architecture/, and keep there only that design and a reason of one clause; do not link decisions/ and comparison/ back to architecture/.
- In a comment beside the code of a decision, state its reason, with a measurement only when the reason rests on it, such as a cost of an order of magnitude rather than of a few percent.

## Comparison with other projects

- Whenever you learn how another ORM, query builder, or migrator handles a scenario of kern-orm, such as from its issues, documentation, or sources, or while researching a design, record it in the file of its topic in [comparison/](comparison/README.md), under a heading of the scenario.
  - Open the scenario with a sentence of what kern-orm does.
  - Give each project an item with its name, a link to its issue, documentation, or source, and a verdict: `fails` when it gets wrong what kern-orm covers, `lacks` when it lacks what kern-orm has, `has` when it has what kern-orm lacks, `differs` when it does the task another way, or `same` when it does what kern-orm does.
- Name another project, in comparison/ and in decisions/, as "Projects" of [comparison/README.md](comparison/README.md) lists it, without a link to the project and without a version unless it differs from the listed one; write a record of an issue or a pull request in the past tense.
  List a new project there with its link and the version you checked.
- Also record a scenario that another project fails while kern-orm covers it in a comment of the test that checks the scenario, such as `// Orchid ORM let a user OR bypass the relation condition: <issue URL>`.
- Keep a capability that another project has and kern-orm lacks, such as `parseNull` of Orchid ORM, in the item of BACKLOG.md that would add it, and move it to comparison/ when the item is deleted.
- Mention another project in a decision only when its design is an alternative that the decision weighs.
- Add a scenario worth comparing that comparison/ does not cover yet to "Scenarios to compare" in [comparison/README.md](comparison/README.md).

## Checks

- Run the `types` script when public types or TypeScript configuration change.
- When a change touches generic types that user code instantiates on every call, such as the signatures and states of query methods, column references, or table and type definitions, run the `bench:types` script of `benchmarks`, report the change of every count in percent, and write the new counts with `-u` in the same change.
  Warn when the growth is substantial, such as when existing queries become more expensive to type-check.
- Run the `test` and `test:node` scripts when behavior changes.
- Run the `test:package` script when package exports, declarations, build configuration, `engines`, or module-level code change, or when transactions or test helpers change; it builds the packages first.
- Run the `test:compat` script when the range of a companion package, what it imports from `kern-orm`, or what companion packages rely on in `kern-orm` changes; it builds the packages first and installs packages from npm.
- Run the `docs:build` script when site pages or the VitePress configuration change.
