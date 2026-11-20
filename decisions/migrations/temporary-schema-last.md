# The temporary schema last in the search path of migrations

The search path of migrations lists `pg_temp`, the schema of the temporary objects of the session, after the target schema and the schemas of the history.
PostgreSQL searches `pg_temp` first for relations and types unless the search path lists it, so a temporary table of the session named as a table of the target schema takes its place in a migration, such as a table that the transaction around `migrate` created: a view created over it is a temporary view, while its migration is recorded as applied.

```sql
SELECT set_config('search_path', '"tenant_1", "extensions", "pg_temp"', true)
```

The design gives up the failure of a statement that has no schema to create in.
PostgreSQL creates an object without a schema in its name in the first schema of the search path that the current role can use, which is `pg_temp` when the role can use no earlier one.
A step that sets a role without `USAGE` on the target schema and the schemas of the history, creates a table, and resets the role then creates a temporary table when the role may create temporary tables in the database, as every role may by default, and its migration is recorded as applied, where `CREATE TABLE` failed with `no schema has been selected to create in`:

```sql
SET LOCAL ROLE reporting;
CREATE TABLE report (id integer);
RESET ROLE;
```

A step that leaves the role set fails in both search paths: without `pg_temp`, at `CREATE TABLE`, and with it, when the migrator records the migration in the target schema.
A migration chooses the roles of its statements, whereas it does not control the temporary objects that the calling code created in the session before it.
A schema of the history before `pg_temp` in which the role may create takes the table in the same way, also in a search path without `pg_temp`.

## A search path without `pg_temp`

The search path could list only the target schema and the schemas of the history, so that a statement with no schema to create in fails.
A migration would then find the temporary relations and types of the session before those of the target schema, whatever the migration does to avoid it short of naming the schema, which a history that applies to any schema cannot do.

## `pg_catalog` before `pg_temp`

The search path could list `pg_catalog` before `pg_temp`, which every role can use, so that a statement with no earlier schema to create in fails with `permission denied for schema pg_catalog` for a role that may not create in it.
PostgreSQL then searches `pg_catalog` at that place rather than first, so the objects of the target schema take the place of the built-in ones, such as a function `lower(text)` of the target schema in every statement that calls `lower`.

## Rejecting a session with temporary objects

The migrator could leave the search path and reject a session whose temporary objects share a name with an object of the target schema.
It would have to check before every statement, since a migration that creates a table and a view over it meets the temporary table only after its first statement, and it does not see the statements of a SQL script or of a function.
