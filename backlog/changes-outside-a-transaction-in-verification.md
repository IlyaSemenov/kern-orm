# Changes outside a transaction in verification

`verifyMigrations` and migration tests run in a transaction, so they check `up` and `down` of a step with [changes outside a transaction](../architecture/migrations.md#changes-outside-a-transaction), while a call outside a transaction block runs those changes instead, such as in production.

- Decide whether the verification runs them in a session on a temporary schema that it drops after, which a database created with `test: true` rejects, or a project tests them on a database of its own.
- Running each change twice would check that it is safe to run again, as its contract requires.
- Decide whether the verification compares the structure that they build with the structure that `up` builds.
