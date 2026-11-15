# Singleton tables whose row always exists

A singleton table holds at most one row, so its queries start in rows `optional`; an application whose migration inserts the row reads it through a query with `required` that it defines once, such as `export const config = db.config.required()` ([user documentation](../docs/orm/singleton-tables.md#a-row-that-always-exists)).

- An option of the table, such as `singleton: "required"`, would start its queries in rows `one` without `required`.
  PostgreSQL cannot keep a table to at least one row, so its queries would still reject without the row, as `required` does.
- Open questions:
  - Whether `delete`, `insert`, and `exists` apply to such a table: deleting breaks the guarantee, inserting always fails, and the row always exists; and whether `upsert` is needed beside `update`.
  - How migrations create the row, such as by an option of `createTable` that inserts it, since the row must exist in each schema of the table, such as of each tenant.
  - The cost of a third state of `TableQueryState`, which every schema pays, also without singleton tables ([decision](../decisions/schemas/singleton-tables.md)); measure it with `bench:types`.
- Preliminary decision: add the option only once the query of `required` proves insufficient in an application.
