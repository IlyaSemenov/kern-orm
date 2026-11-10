# Runtime defaults of columns

A column can declare a default that kern-orm gives an insert that omits the column: `.default(value)`, or `.default(() => value)`, called for each inserted record, such as `t.uuid.primaryKey().default(() => randomUUID())`.
`hasDefault()` stays the mark of a default of the database.

- An insert may omit a column with a runtime default, as one marked with `hasDefault`.
- Decide whether a default can be an expression, such as a `sql` fragment.
- Orchid ORM 1.78.47 takes a value or a `sql` fragment of `.default` as a default of the database, which its migrations declare, and only a callback as a default at runtime ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#default)); in kern-orm, a value of `.default` is a runtime default as well.
