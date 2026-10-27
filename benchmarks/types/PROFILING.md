# Profiling the type-check cost

How to find what makes code that uses the API expensive to type-check; the Benchmarks section of [AGENTS.md](../../AGENTS.md) describes the benchmarks and their commands.

## Choose the measurement

- `bench:types` counts with TypeScript 7 the instantiations that a callback adds to its file.
  Attest checks with `tsc --extendedDiagnostics` the whole program of the file without its benchmarks and of the file with the callback, and subtracts their counts.
  Both check the modules that the file imports, such as `fixture.ts`, so the work of checking them cancels out of the difference, and the first use of their values in the callback, such as the first comparison of two `Db` types in the benchmarks of `first-use.bench.ts`, counts.
- `profile:types` counts with TypeScript 6 the instantiations per copy of a callback, as the difference between 10 copies and 1 copy, divided by 9.
  It shows only the work that each copy repeats, such as for a query whose `select` callback returns a new object type; work cached after the first copy, such as a comparison of the same pair of types, shows as 0.
- For a one-time cost, such as the first comparison of two `Db` types or the first filter of a table, run `profile:types` with `--once`: it counts the instantiations that the first copy adds, as the difference between 1 copy and none, the way `bench:types` counts them, with TypeScript 6; on the benchmarks of this directory, the two counts differ by 4 instantiations at most.
- To profile code that no benchmark has, add a temporary benchmark to a file of this directory and remove it afterwards.
- Compare only counts measured the same way: for the benchmark "unbound query", `bench:types` and `--once` count 902 instantiations and `profile:types` 436 per copy.

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
- `typeArgumentsRelatedTo` compares two references to one generic type by their type arguments, as the variances that `getVariancesWorker` measured say; when a variance is marked unreliable or unmeasurable, a failed comparison of the arguments falls back to comparing members, which for a class of many generic methods, such as `SelectQuery` without `out` on its parameters, takes thousands of instantiations for each new pair of types.
  - To see the measured variances, copy `benchmarks/node_modules/typescript-6/lib` outside the repository and print `Debug.formatVariance` of each type parameter at the end of `getVariancesWorker` in `_tsc.js` of the copy.
  - To find the member that prevents covariance, add `out` to the type parameter temporarily: error TS2636 names the first such member.
  - A generic probe such as `<Super extends SelectQueryState, Sub extends Super>(query: SelectQuery<Sub>): SelectQuery<Super>` passes by comparing members, so it proves no variance.
- Each relation, such as assignability or identity, caches its comparisons by the pair of types, so a comparison costs again only for a new pair, such as for each query with a new `select` callback.
