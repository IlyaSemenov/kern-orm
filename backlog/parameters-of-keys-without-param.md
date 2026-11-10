# Parameters of keys without `param`

A key of a [query of groups](../architecture/queries.md#groups) with a value interpolated into it, such as ``sql(t.date)`(${submission.createdAt} at time zone ${timeZone})::date``, fails in `HAVING` also when the condition reads it through its selected field, since the compiler binds only the parameter of `param(type, value)` once in a query of groups, so the copy of the key there has a parameter of its own.
Users must create the parameters of such a key with `param`, as [the grouping guide](../docs/queries/grouping.md#keys-of-expressions) explains, while the same value without it needs no type anywhere else.

- Preliminary decision: bind every parameter node once in a query of groups, so that copies of one expression node, such as a field read in `having` or a sort key built from the same expression, compile to equal text; the lookup then costs only statements of groups.
- Check with PostgreSQL that it takes a repeated parameter without a type in `HAVING` and `ORDER BY` for the key of `GROUP BY`, such as of `AT TIME ZONE $1`.
- Decide what happens to a parameter node reused by one expression in contexts that infer different types, such as an untyped expression compared with an `integer` and with a `text` column, for which PostgreSQL deduces one type of the parameter; the compiler binds a parameter without a type apart at each place for this reason.
