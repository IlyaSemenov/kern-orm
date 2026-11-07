# Lowering visits every node

Lowering visits every node of a statement for queries in expressions rather than tracking which subtrees hold a query, which keeps lowering simple.

- Tracking it would let lowering pass the filters, the values of a mutation, and `set` that hold no query through without visiting them.
- Visiting them makes `db.$compile` of a built statement without queries in its expressions take longer on Bun 1.4.4 and Node.js 24.18 ([benchmark](../../benchmarks/runtime/preparation.bench.ts)); the medians of 10 pairs of processes, with their intervals of 97.9% confidence, are:
  - for `in` of 1000 values, 22% (17 to 29%) on Bun and 17% (12 to 23%) on Node.js;
  - for a tree of 256 conditions, 12% (7 to 18%) on Bun and 15% (7 to 18%) on Node.js;
  - for a select of a few conditions, an insert of 1000 records, and nested relations, the medians of 3 to 8% are inconclusive.
