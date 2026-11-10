# SQL fragments of users in pages after an offset

Research and a decision: whether a SQL fragment of a user in a nested query can keep the nested queries of a page after an offset over the rows of the page, which kern-orm cannot tell from the text of the fragment, since a fragment may hold an aggregate of the rows of an enclosing query, such as a user-defined aggregate that only the catalog of the database knows.

- A contract that a fragment in a nested query never aggregates the rows of an enclosing query, for which the aggregate methods exist, would drop the check, but breaking it would change results silently rather than fail.
- A variant of `sql` for fragments that are known to be scalar would keep the check for other fragments, at the cost of a public API for a rare case.
- A fragment that does aggregate the parent rows makes the parent query return one row, so the nested queries run once anyway; only scalar fragments lose the speed-up, also those that read the parent table only through a query correlated with it, such as ``sql`${field.position} < ${form.fields.count()}` ``.
