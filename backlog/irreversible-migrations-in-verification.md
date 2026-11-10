# Irreversible migrations in verification

A migration whose `down` cannot restore the structure, such as one that adds a value to an enum type, since PostgreSQL cannot remove a value of an enum, fails `verifyMigrations`.

- Preliminary decision: an option of `verifyMigrations` lists the keys of such migrations, which it applies without running their `down`, running `setup`, `up`, and `assertUp` of their migration tests.
- Decide what `rollback` and `redo` do with such a migration, such as reject before they change anything.
