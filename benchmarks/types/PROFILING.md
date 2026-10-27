# Profiling the type-check cost

How to find what makes code that uses the API expensive to type-check; the Benchmarks section of [AGENTS.md](../../AGENTS.md) describes the benchmarks and their commands.

## Choose the measurement

- `bench:types` counts with TypeScript 7 the instantiations that a callback adds to its file.
  Attest checks only the file of the benchmark, with `getSemanticDiagnostics` and `getDeclarationDiagnostics` of that file, so the types of imported values, such as those of `fixture.ts`, resolve inside the first callback that uses them, unless the baseline uses them first; the benchmarks of `first-use.bench.ts` include that.
- `profile:types` counts with TypeScript 6 the instantiations per copy of a callback, as the difference between 10 copies and 1 copy, divided by 9.
  It shows only the work that each copy repeats, such as for a query whose `select` callback returns a new object type; work cached after the first copy, such as a comparison of the same pair of types, shows as 0.
- For a one-time cost, such as the first comparison of two `Db` types or the first filter of a table, compare the counts of two files that differ only by the code, measured the same way:
  - each file alone, as Attest checks it: `program.getSemanticDiagnostics(file)` and `program.getDeclarationDiagnostics(file)` of the TypeScript API, then `program.getInstantiationCount()`;
  - or the whole program of each file with `tsc --extendedDiagnostics`, which also checks the modules that the file imports.
- Keep such probes outside the repository, and resolve `kern-orm` in them to the built declarations, `packages/kern-orm/dist/*.d.mts`, through `paths` of their configuration.
- Compare only counts measured the same way: for the benchmark "unbound query", TypeScript 6 counts 1057 instantiations as Attest measures them and 433 per copy as `profile:types` does.

## Avoid misleading probes

- Use each value of a probe in its own statement, such as `void formsDb`, rather than in an array literal: TypeScript reduces the element type of an array literal by subtypes, which compares the values with each other and pays their comparison in advance, such as of two `Db` types.
- Keep a probe free of type errors, whose elaboration adds instantiations.
- Name a benchmark after what it measures: a benchmark of a repeated call warms up with a call of the same kind on other columns, and one that measures the first use of a table, such as "first filter of a table", says so.
- Expect `--relations` to print the comparisons that led to the first instantiations of a label in the whole file, which are often those of the baseline rather than of the profiled callback.

## Find the cause

Check the conditions in `benchmarks/node_modules/typescript-6/lib/_tsc.js` rather than assuming them:

- `instantiateTypeWithAlias` counts an instantiation of a type for which `couldContainTypeVariables` holds and which the cache of the active mapper does not hold yet, also when `getObjectTypeInstantiation` then returns an instantiation that it already has.
  `couldContainTypeVariables` holds for the type of an object literal, such as the columns passed to `defineTable`, and `getObjectTypeInstantiation` makes it hold for a new instantiation of a mapped or anonymous type, such as `ToColumns<…>`, when it holds for one of its type arguments; a type keeps the result in its flags `CouldContainTypeVariablesComputed` and `CouldContainTypeVariables`.
  So the types of tables and schemas built from object literals count again with each new mapper, such as when the constraint of a type parameter is instantiated on a call; check these flags of a type before assuming so.
- `isDeferredTypeReferenceNode` defers a reference to a generic type that is the whole body of a type alias, or that is written inside one and has a type argument that may resolve to an alias, such as a conditional type; `--focus` shows its instantiations as `deferred=true`.
- `typeArgumentsRelatedTo` compares two references to one generic type by their type arguments, as the variances that `getVariancesWorker` measured say; when a variance is marked unreliable or unmeasurable, a failed comparison of the arguments falls back to comparing members, which for `SelectQuery` takes thousands of instantiations for each new pair of types.
  - To see the measured variances, copy `benchmarks/node_modules/typescript-6/lib` outside the repository and print `Debug.formatVariance` of each type parameter at the end of `getVariancesWorker` in `_tsc.js` of the copy.
  - To find the member that prevents covariance, add `out` to the type parameter temporarily: error TS2636 names the first such member.
  - A generic probe such as `<Super extends SelectQueryState, Sub extends Super>(query: SelectQuery<Sub>): SelectQuery<Super>` passes by comparing members, so it proves no variance.
- Each relation, such as assignability or identity, caches its comparisons by the pair of types, so a comparison costs again only for a new pair, such as for each query with a new `select` callback.
