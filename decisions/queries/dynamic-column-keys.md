# Dynamic column keys in `select`

`select` on queries and mutations infers the argument tuple so that each fixed column name guarantees its field.
A union of argument tuples retains the selections of its individual branches.
Representing a union-valued key by optional fields lets callers read the possible fields after checking their presence without enumerating every combination of keys.

Inferring only the union of all arguments costs fewer type instantiations, but it gives a dynamic key such as `"id" | "name"` the same result as the two arguments `"id", "name"`.
Rejecting such arguments would also reject lists of columns chosen at runtime.
The lists of the columns of records in SQL text, of `columnsOf` and `createSqlColumns`, follow the same rule, so that one list of keys requires the same fields in either API; the values of the fields of `createSqlColumns` are [told by key](../sql-queries/values-of-columns-by-key.md).

For a fixed tuple of individual column names, every field is required and the type skips the recursive walk.
The [two-column benchmark](../../benchmarks/types/queries.bench.ts) takes 267 instantiations, compared with 234 for inferring the union alone and 289 for walking every tuple recursively.

Checking only for unions misses `string` and template keys such as `col_${number}`, each of which can name more than one column.
Accounting for open keys keeps the two-column benchmark at 267 instantiations.
The largest relative increase is 2.65% for the first unbound query (2567 to 2635).
