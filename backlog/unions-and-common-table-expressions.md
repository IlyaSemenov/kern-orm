# Unions and common table expressions

`UNION ALL` of queries, `WITH` queries, and queries of a derived source of another query, such as the nearest administrators of a record among those of its ancestors.
[Records of a relation at any depth](records-of-a-relation-at-any-depth.md) need `WITH RECURSIVE` too.
A query of `WITH` that locks the rows that the rest of a statement changes, such as `WITH locked AS (SELECT ... FOR UPDATE) UPDATE ...`, is written as SQL text with the query interpolated until then.
[Groups](../architecture/queries.md#groups) of the rows of a union of queries need it too.
