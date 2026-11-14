# Backing of keys in the table check

`findTableMismatches` finds the unique indexes that back a key in `pg_index`, by the rules by which PostgreSQL infers the arbiters of `ON CONFLICT` of the columns of the key: of the set of its columns, without expressions or a predicate, and valid; one of them must exist, and none may be deferrable.

```sql
SELECT indexrelid, indkey, indnkeyatts, indexprs IS NOT NULL, indpred IS NOT NULL, indimmediate, indisvalid
FROM pg_index
WHERE indisunique AND indrelid = 'form_field'::regclass
```

The alternative asks PostgreSQL itself, by planning the insert that `onConflict` of the key builds, for each key:

```sql
EXPLAIN INSERT INTO form_field (form_id, position) VALUES (NULL, NULL) ON CONFLICT (form_id, position) DO NOTHING
```

It would follow every rule of the inference, also those of collations and operator classes of indexes, which the catalog query does not read.
It gives up more than it gains:

- The planner leaves rejecting a deferrable arbiter to the executor, so the plan of a key backed only by a deferrable index succeeds, and the insert then rejects.
- A key without an index fails the statement, which aborts the transaction that the check runs in unless a savepoint isolates it, so each key needs a statement and, in a transaction, a savepoint of its own.
