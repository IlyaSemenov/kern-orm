# Union of queries of several tables

Optional, research: a function that types a union of queries of several tables or kinds, such as `cond ? db.foo : db.bar`, as one query whose overloaded methods TypeScript can call, while a query of one table keeps its plain types.

- At runtime it returns its argument: methods resolve columns by name in the table of the chosen query.
- Its table has the columns that every table has with the same type; a column of the same name and another type and a relation of one table are unavailable.
- Its result and rows mode are the unions of those of the queries, and its kind is bound or unbound when every query is, and either kind otherwise.
- The state keeps the source tables as a new part, so that a `Db` still checks them against its schema.
- Check first whether a union of tables in the state, `SelectQuery<InitialQueryState<typeof foo | typeof bar>, Kind>`, already gives the common columns.
- Branches of a callback of `use` or of a helper that leave different states could become one query of a union state the same way.
- Alternatively, methods that change the state could apply to a union of queries by one of the designs that [architecture/queries.md](../architecture/queries.md) weighs, at the costs it records.
