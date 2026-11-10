# Checking tables against the database

A check, such as in tests after migrating, that each table of a schema exists with its columns and their nullability, that a constraint or a unique index backs each of its keys, that a unique index of `(true)` backs each singleton table, and that a foreign key backs each required relation `one`, instead of generating migrations from tables, which [the scope of the migrator](../decisions/migrations/migrator-scope.md) leaves out.
