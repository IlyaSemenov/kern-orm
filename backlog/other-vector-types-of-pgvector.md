# Other vector types of pgvector

Built-in types of `halfvec`, `sparsevec`, and `bit` with the distances of pgvector, beside `vector`.

- `halfvec` has the text representation of `vector`, `[1,2,3]`, and its operators: `equalityOperators` and `vectorOperators`.
- `sparsevec` needs a representation of its values, such as an object of its dimensions and of its nonzero elements by index, written by pgvector as `{1:1.5,3:2}/5` with indexes from 1.
- `bit` is a type of PostgreSQL, whose distances `<~>` of Hamming and `<%>` of Jaccard pgvector adds; they would be operators of their own, such as `hammingDistance` and `jaccardDistance`, apart from `vectorOperators`.
- Drizzle ORM has `halfvec`, `sparsevec`, and `bit` in `pg-core`, of `number[]` for `halfvec` and of strings for the others, with `hammingDistance` and `jaccardDistance` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/functions/vector.ts)).
- pgvector-node has a class `SparseVector` of its dimensions, indexes from 0, and values ([source](https://github.com/pgvector/pgvector-node/blob/v0.3.1/src/sparse-vector.js)).
