# Queries of SQL text

## Rows of SQL text

A query of SQL text decodes each field from the result column of its key by the type of the field, and rejects a result without the column.

- Orchid ORM, lacks: it types the rows of `$query` by a type argument that nothing checks, over the values that its driver parses ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-methods.md#query)).
