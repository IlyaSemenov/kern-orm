# Rollback of `replaceView` chosen by an option

`replaceView` replaces the query of a view with `CREATE OR REPLACE VIEW`, which keeps the grants, the comment, and the triggers of the view, and its rollback restores the previous query the same way.
PostgreSQL rejects that rollback when `to` appended columns, which replacing cannot drop, so such a step passes `rollback: "recreate"`, and its rollback drops the view and creates it again from `from`:

```ts
replaceView("public_form", "SELECT id FROM form", "SELECT id, name FROM form", {
  rollback: "recreate",
})
```

```sql
DROP VIEW "public_form"
;
CREATE VIEW "public_form" AS SELECT id FROM form
```

The option names what rollback does rather than the change that requires it, so that the call shows that rollback loses the grants, comment, and triggers.

The design gives up a rollback that needs no option: a migration that appends columns without it fails to roll back, which `verifyMigrations` finds, and one that passes it needlessly loses the grants on rollback, which `verifyMigrations` finds when the view has grants.

## Falling back when replacing fails

Rollback could be a `DO` block that replaces the query and, when PostgreSQL rejects the replacement with `invalid_table_definition`, drops the view and creates it again:

```sql
DO $$
BEGIN
  EXECUTE 'CREATE OR REPLACE VIEW "public_form" AS SELECT id FROM form';
EXCEPTION WHEN invalid_table_definition THEN
  DROP VIEW "public_form";
  EXECUTE 'CREATE VIEW "public_form" AS SELECT id FROM form';
END
$$
```

Rollback would keep the view whenever PostgreSQL can without an option.
Its SQL would not read as the statements that it runs, and whether rollback keeps the grants would depend on an error caught at run time rather than on the migration.

## Dropping and creating the view on every rollback

Rollback could always drop the view and create it again, without an option.
It would lose the grants, the comment, and the triggers on every rollback, also of a change that keeps the columns, which replacing supports, and fail whenever other views depend on the view.
