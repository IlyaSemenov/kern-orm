# Bulk inserts beyond the parameter limit

A helper or an opt-in option of a query for inserts of more values than the 65535 parameters of a statement, such as tens of thousands of records, which `insertMany` rejects, as [architecture/mutations.md](../architecture/mutations.md#statements) states.

- Records of the same columns of plain values could be sent as one array parameter of the text representations of each column, `INSERT ... SELECT ... FROM unnest($1::text[], $2::text[])` cast to the types of the columns, whose text does not depend on the number of the records; records that omit a column for its `DEFAULT` or give an expression need `VALUES`.
- Alternatively, the helper splits the records into statements in a transaction of its own; then a later statement sees the rows of an earlier one, unlike one statement.
  Orchid ORM splits such an insert by itself, and a failure of a later statement left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).
- Benchmark the variants against `VALUES` for small and large numbers of records before choosing.
