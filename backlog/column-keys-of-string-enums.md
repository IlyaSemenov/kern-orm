# Column keys of string enums

A key of a column typed as a member of a string enum, such as `Column.Id` of `enum Column { Id = "id" }`, told as the column of its value, which the [decision](../decisions/queries/string-literal-column-keys.md) declines for the cost of naming each field of every selection.

- The cases to cover, in `select` of queries and mutations, `columnsOf`, and `createSqlColumns`:
  - a member beside its value among the keys of one selection, such as `select(column, key)` of `column: Column` and `key: "id" | "note"`, and `select(Column.Id, "id")`, which lose the field;
  - a field selected before that a member replaces, which is typed as `never`;
  - the primary key of `columnsOf` of keys that are members, also of a union of lists such as `[Column.Id] | ["id"]`;
  - a table whose columns are declared by members, and keys of numbers and symbols of `PickSelectedColumns`, which a change must keep.
- Find a way that costs a selection of fixed keys nothing, such as a check of the keys for a member before naming the fields.
