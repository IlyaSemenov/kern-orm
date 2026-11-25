# Sequences in the table check

[`findTableMismatches`](../architecture/schemas.md#table-check) checks the tables of a `Db` but not its [sequences](../architecture/schemas.md), so a sequence missing from the PostgreSQL schema of the `Db` fails only when a statement uses it.

- Check that each sequence of the schema exists as a sequence, by `relkind = 'S'` of `pg_class` in the PostgreSQL schema that the check reads.
- Decide whether the result names a sequence by its key apart from tables, since a mismatch names the key of its table.
