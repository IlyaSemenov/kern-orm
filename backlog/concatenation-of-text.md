# Concatenation of text

Concatenation of text without `sql`, such as of a full name, which a query writes as ``sql(t.text)`${user.firstName} || ' ' || ${user.lastName}` ``.

- `||` is a binary operator of a value, so it is a node of the binary operators that [arithmetic operators](../architecture/types.md#arithmetic-operators) create, of the lowest precedence of them.
  - Decide its name, such as `concat` of `textOperators`, and whether it takes an operand of another type, which PostgreSQL converts to text for `anynonarray || text`.
  - Its result is `NULL` when an operand is, so types follow the nullability of the operands, as for arithmetic, and its type is `text`, whatever the type it is called on, as for `lower`.
- `concat` and `concat_ws` are functions that skip `NULL`, such as of a middle name that may be missing, so they are [functions of expressions](../architecture/types.md#functions-of-expressions) with `text` values, which are `NULL` only for `concat_ws` of a separator that is.
- `||` of arrays and of `jsonb` takes the same node with operators of their types.
