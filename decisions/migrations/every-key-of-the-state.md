# Every key of the state in the table of versions

The table of versions of a target has a row for every key whose changes its schema has, and a call compares these keys with the keys of the history.
The keys tell a state of this history from a state of another one with the same last number: `migrate` rejects a target that lacks a migration before an applied one, such as one merged with a number before it, and a target that has a key that the history lacks from its first key up to its last one, such as the database of a developer who applied the migrations of another branch.

The design gives up a table of one row, so a [baseline](baseline-without-a-key.md) needs `replaces`, the keys that a target it built records.

## One row with the last applied key

The table could keep the last applied key alone, as the table of Alembic keeps the heads of its revisions, and Drizzle ORM reads only the last row of its table.
A baseline would then need no `replaces`: a target that it built would record the key of its state.
A migration merged with a number before the applied one would be skipped without an error, a state of another history with the same or a later number would pass as one of this history, and the table of every existing target would change.
