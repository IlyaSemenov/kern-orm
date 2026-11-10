# SQL generation

- **AST** (`ast/`): the SQL AST, structural expression and statement nodes, and their pure transformations, such as Boolean simplification.
  A select statement nests queries in scalar subqueries, `EXISTS`, and derived sources of `FROM`, plain or `LATERAL`; nodes store no lexical scopes, which the compiler derives from the position of a query in the tree.
- **Lowering** (`lowering/`): turns the semantic node of a query into a SQL select statement of the AST, and a mutation into its `INSERT`, `UPDATE`, or `DELETE` statement, which the compiler compiles, and keeps a statement of SQL text as it is, except that it lowers the queries in its interpolated expressions; the compiler knows no relation definitions or semantic query nodes.
  Each nested query becomes a scalar subquery in place of its field, of its packed rows or, for an aggregate query without a [conversion](queries.md#converting-results), of its statement, or `EXISTS` of its rows for such a query of `exists`, and a query other than an aggregate query or a query of `exists` without queries or literals in its fields keeps its fields as its projections.
  A statement keeps the [conversion of its query](queries.md#converting-results), which SQL does not see, for the result plan.
  A query of `$select` has no source and becomes a statement without `FROM` of rows `one`, which PostgreSQL returns as exactly one row.
  A query of `exists` becomes a statement without `FROM` of one row of `EXISTS` of its rows, whose query selects nothing, which PostgreSQL accepts, apart from the rows of `distinct` and `distinctOn` below, and has no order.
  An aggregate query becomes a statement of its aggregate without an order, which PostgreSQL rejects beside an aggregate unless it sorts by aggregates; `string_agg` takes the order of the query inside its call, and `coalesce` of the fallbacks of the query wraps the call.
  An aggregate takes the rows before the limit and the offset of its own query, so with a limit or an offset it reads the rows of the page from a derived source that selects the first argument of the aggregate and its sort keys, as nested rows are packed; `count(*)` reads a derived source without projections or an order.
  An aggregate method of a query of [`groupBy`](queries.md#groups) reads the groups from such a source, which has the keys and `having` of the query, as a query of `exists` keeps them in `EXISTS`.
  An aggregate method of a query of [`distinct`](queries.md#distinct-rows) or [`distinctOn`](queries.md#first-row-of-each-group) reads the rows from a source that `lowerDistinctRows` lowers from the fields that the query kept, through which it lowers the keys, the order, and the argument, so that each value of a selected field is its projection, and `EXISTS` of such a query holds the same source.
  The source of `distinct` selects the fields, which `DISTINCT` compares, and the aggregate reads the projection of the selected field that is its argument.
  The source of `distinctOn` selects the argument as `value`, each key that it does not select otherwise, since PostgreSQL requires a select list with `DISTINCT ON`, and the sort keys, and lowers no field of nested rows, which neither a key nor a sort key reads.
  The source of `count(*)` and of `EXISTS` has no order, since the number of the rows does not depend on it.
  PostgreSQL assigns an aggregate to the innermost query whose sources its arguments and its filter refer to, so an argument that does not refer to the source of its query outside nested queries, such as a column of the parent row, is read from such a derived source too.
  An [aggregate function](queries.md#aggregate-functions) is an expression of its query rather than the statement of an aggregate query, so its call stays where it is written, without a derived source.
  Before deriving a page or packing rows, lowering checks directly selected unfiltered aggregates of a query of groups, except counts, for ownership by that query.
  The check follows free column references through nested query scopes, ignoring columns bound inside those queries, and rejects an aggregate of only enclosing sources; a raw SQL projection keeps its declared nullability and is not checked.
  The statement of an executed query sorts by the positions of its projections, while the statement of a packed nested query keeps its sort expressions, which packing reads.
  A query of [`distinct`](queries.md#distinct-rows), [`distinctOn`](queries.md#first-row-of-each-group), or [`groupBy`](queries.md#groups) also sorts by positions as a subquery, of `IN`, of an expression, or in SQL text: PostgreSQL finds a sort expression of `SELECT DISTINCT` in the select list, one of `GROUP BY` among the keys, and a key of `DISTINCT ON` among the sort keys, only when it is equal, and a repeated expression has aliases of its own and, apart from the parameters of casts in a query of groups, parameters of its own.
  A mutation keeps its statement and packs the nested queries of the fields of its `RETURNING` as a select list does.
  For a `Db`, lowering rejects a query of a relation outside its definitions and a nested query or a query of an expression bound to another `Db` at any depth, and the compiler rejects a table interpolated from a query bound to another `Db`.
  An expression holds a query, such as of `exists` in a condition, in a semantic node of the query and its `Db` in the shared union of expression nodes, as it holds an unresolved object of column values.
  Lowering replaces it in every expression of a statement: of the fields, the filters, the order, the arguments and fallbacks of aggregates, the parts of mutations, and SQL text.
  A query of `exists` becomes `EXISTS` of its rows, another query of one value a scalar subquery of its statement, the query of the values of `IN` its statement, and a query of records or of rows `many` in SQL text its statement in parentheses.
  Lowering checks each such query as a nested query of a field, and the compiler rejects a query that lowering has not replaced.
  - It keeps every expression node, filter, and array of nodes without a query, and creates only the nodes that hold one, so that an expression without a query allocates nothing.
    It visits every node rather than tracking which subtrees hold a query, which keeps lowering simple ([decision](../decisions/sql/lowering-visits-every-node.md)).
  - A sort key of a selected expression, or of the query of a selected field of an aggregate or of `exists`, takes the node of the lowered projection, so the statement still finds the projection that has its value.
  - The lowering of expressions and projections reaches the lowering of a query and of a query of `exists`, which nested queries recurse into, only through the context of the statement (`lowering/context.ts`), so that the modules of `lowering/` import one another without cycles.
- **Compiler** (`compiler/postgres/`): turns an AST into SQL text, parameters, and result decoding metadata.
  Parameters and source aliases belong to the whole statement, apart from the lexical scopes that decide which sources a column reference sees.
  Whether an operand needs parentheses depends only on its node kind and its position in the parent, decided in one place.
- **Result** (`result/`): decodes driver rows and packed nested rows by the result plan of a compiled query, or the number of the rows of the command tag of a mutation without `RETURNING`, and converts the result as the plan tells.
  The database layer (`database/result.ts`) holds the rows modes, how a query of one row takes its row, the keys that a record can have, and `NotFoundError` and `ResultDecodeError`, which the ORM throws too; `RequiredRelationError` is of the ORM.
  The ORM result decoder reads the fields of a statement of SQL text from the result columns of their keys, as [queries of SQL text](sql-queries.md#results) describe.
  The result plan is internal: `toSQL` and `$compile` return only the text and parameters of a statement.
- **Nested rows** (`lowering/nested.ts`): builds a query that packs the rows of a nested query as JSON, with the result plan that decodes them.

## Statements

- Column references point to an occurrence of a source (`SourceNode`), a table or a derived source, by object identity, never by alias string.
  A reference to a derived source names the key of a projection of its query, never a column of a physical table.
  A derived source can replace an occurrence of a table in `FROM` of its query: outside the query, a reference to the occurrence reads the projection of the derived source under the key of the column, so lowering moves the rows of a query into a derived source without rewriting the references of its other clauses and nested queries.
  The compiler gives every occurrence an alias unique in the statement.
- Every identifier the compiler generates, such as an alias or the SQL name of a projection, fits the 63 bytes of a PostgreSQL identifier in any server encoding, since PostgreSQL truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)); a character other than ASCII counts as 4 bytes, the most it takes in a server encoding.
  - An alias is the name of its table, or `subquery`, cut to 50 bytes and numbered when the statement already has it.
  - Rows of a query of kern-orm are decoded by position, so the key of a result field stays apart from the SQL name of its projection, which only a reference through a derived source uses.
    A key of up to 50 bytes is the name itself, and a longer key is named by its prefix of more than 50 bytes and its position, so the names of the projections of a query differ.
- A column reference resolves to a source visible from its position, as in PostgreSQL ([PostgreSQL](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL)); the compiler rejects any other reference, including one to a source that has an alias elsewhere in the statement, such as in a sibling subquery:
  - the keys of `DISTINCT ON`, the select list, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, and the subqueries in them see the sources of their query and of enclosing queries;
  - the `ON` condition of a join sees the sources up to the joined one;
  - a plain derived source sees only the sources of enclosing queries, and a `LATERAL` one also the sources before it in the same `FROM`;
  - `LIMIT` and `OFFSET` see only the sources of enclosing queries.
- A query without a source compiles without `FROM` and has no joins; its clauses see only the sources of enclosing queries.
- A table interpolated into a SQL fragment compiles as its name, qualified as an occurrence of the table is; it is not a source, so it has no alias and no column reference sees it.
- A mutation statement declares the occurrence of its table with an alias, such as `UPDATE "form" AS "form"`, which `SET`, `WHERE`, and `RETURNING` see; the values of `VALUES` of an insert see no source, the values of `DO UPDATE SET` of its `ON CONFLICT` also see the row proposed for insertion as `excluded`, and `SET`, the columns of an insert, and the target of its `ON CONFLICT` name physical columns without the alias, or the target is the expression `(true)` of the unique index of a singleton table.
- A statement takes at most 65535 parameters, which the protocol of PostgreSQL counts in 16 bits, so the compiler rejects a further parameter.
- A query of groups binds the parameter of a cast node, such as of `param(type, value)`, and of `param` of a [fragment of the database layer](types.md#sql-fragments-of-the-database-layer), once, under one placeholder at every place of the cast in the query: PostgreSQL takes an expression in `HAVING`, `ORDER BY`, or the select list for a key of `GROUP BY` only when it is equal to the key, and the cast gives the parameter the same type at every place.
  A bare parameter binds at each place, since it takes its type from its place, so one placeholder could convert its value by the type of another place.
  Each query binds by its own `groupBy`: a query without groups nested in a query of groups binds at each place too, since PostgreSQL matches expressions with the keys only in the query of groups itself ([decision](../decisions/sql/parameters-of-groups.md)).
- Every place of a source in a statement is its own occurrence: a query inserted twice declares its sources twice under different aliases.
  A source that appears where it is already visible, such as a query nested in itself or a source joined twice, is rejected, since its column references would be ambiguous; a nested query over the same table starts from its own `from`.
- A scalar subquery selects exactly one field, and a subquery interpolated into SQL text any number of fields, which the text reads.
- A literal has no projection: lowering drops it from the fields of a statement before anything else reads them, so the select list, the positions of `ORDER BY`, packing, and the fields of a subquery interpolated into SQL text know only the fields that SQL selects, and a query of only literals selects nothing, or has no `RETURNING`.
- An executed query sorts by the position of the projection that has the value of a sort expression, such as `ORDER BY 2`, and by other expressions as they are; a nested query sorts by its sort keys as packing describes, with the same rule of which projection has the value.
  Only a projection of the same column or of the same expression node is guaranteed to have the value of a sort expression.
  So sorting repeats neither a selected expression nor its parameters in `ORDER BY`, also in a generic plan.
- The compiler compiles a key of `GROUP BY` or of `DISTINCT ON` as the position of the projection that has its value among the final projections of its `SELECT`, by the same rule of the same column or expression node, such as `GROUP BY 2`, and another key as its expression.
  So the keys stay expressions in the statement, and one place covers the projections of an executed query and those that lowering adds, such as the sort keys of packed rows and the argument of an aggregate.
  A selected expression repeated in `GROUP BY` would have aliases of its own and parameters of its own other than of casts, which PostgreSQL rejects with `must appear in the GROUP BY clause` or `subquery uses ungrouped column`.
  A key of a selected field takes the node of its lowered projection, since lowering replaces the node of a field that holds a query.

## Result decoding

- The result plan of a query with literals has a record template, which gives every field in its order and the value of each literal.
  Decoding creates each record from the template, so its keys keep the order of the selection, and assigns the values of a row by position among the fields that SQL selects.
- Result decoding rejects a driver row or a packed row that does not match the result fields instead of reading a missing value as `NULL`.
  A query of one row rejects more than one row, since it may have no limit; a `NULL` value of a query of values is `null`, not a missing row.
- The class of a decoding error tells which contract the result breaks, wherever its query is nested:
  - A missing row of rows `one` is `NotFoundError`, executed or nested, such as in a field of `$select`.
  - A missing row of a query whose row a required relation guarantees is `RequiredRelationError`, which names the relation: the database breaks the guarantee rather than misses a record that the query looks up.
    Lowering names the relation of such a query in `guaranteedBy` of its statement, which packing passes to the result plan of the nested rows; types keep no part of the state for it.
  - A row that does not match the result fields, and a value that fails to decode, is `ResultDecodeError`, with the error of the value as its cause.
- An error has the path of the failing value or of the missing row from its result field, such as `title` or `fields[2].form`, as its `path`, after the index of the driver row of a query of rows `many`, such as `[2].fields[2].form`; a missing row of an executed query and a driver row of another width have none.
  Decoding builds the path only on a failure, as the failure passes up through the enclosing fields and the driver row, and creates the error once the path is complete, so that a missing row keeps its class.
- A result plan converts the result of its rows after it decodes all of them, by `map` of each row and then `transform` of the whole result, in every rows mode and at any depth, so a missing row of rows `one` rejects before a conversion, and the decoded values do not depend on it.
  A statement that reads the number of its rows from its command tag checks them first and converts what it resolves to in the same way: the number has no rows, which `map` rejects before the statement runs, and only records can be missing.
  - A failure of a callback is `ResultDecodeError`, as of a decoder of a type, with the error as its cause, so that a bug in a callback names the value that it fails on; an error that a callback throws to reject a result needs `cause` to be told apart.
  - Its `path` names the conversion by the fields before it, as the callbacks see them: the field of nested rows, such as `fields`, with the index of the row for `map` of rows `many`, such as `fields[2]`.
    A failure of `map` of an executed query of rows `many` has the index, such as `[2]`, and one of the only row or the whole result of an executed query has no `path`.

## Nested rows

- A nested query is selected as a scalar subquery of the select list rather than as a `LATERAL` join, since PostgreSQL can evaluate it after the sort of the parent and stop once it reaches the limit ([decision](../decisions/nested-rows/nested-queries-as-scalar-subqueries.md)).
- PostgreSQL also evaluates a scalar subquery of the select list for the rows that an offset skips, so a query that selects nested queries reads a page after an offset from a derived source that replaces its table ([decision](../decisions/nested-rows/pages-from-derived-sources.md)).
  The source applies the filters, the keys and `having` of a [query of groups](queries.md#groups), the order, the limit, and the offset of the query, and selects the columns of the table that the fields and the nested queries of the query read at any depth, the other scalar fields of the query, which it evaluates before the limit and the offset as the query would, such as a window function over all its rows or an aggregate of a group, and the value of each other sort expression.
  A field of an aggregate or of `exists` that the query sorts by or that is a key of the groups is such a scalar field, since the order and the keys need its value for every row.
  It selects no other column, which PostgreSQL would reject beside an aggregate of a SQL fragment, such as `count(*)`.
  A query of groups groups its rows in the source, which is then the query of groups that binds the parameter of a cast once, as [statements](#statements) describe; a key needs no projection of its own there, since it compiles as the position of a projection that has its value or as its expression.
  The query reads them from the source and evaluates only its nested queries over the rows of the page, which it sorts again by the sort keys of the source, since the order of a derived source does not carry into the query that reads it.
- Without a limit, PostgreSQL also evaluates the select list of `DISTINCT ON` for the rows of a group after its first, so a query of [`distinctOn`](queries.md#first-row-of-each-group) that selects nested queries reads its first rows from such a derived source, also without an offset ([decision](../decisions/nested-rows/pages-from-derived-sources.md)).
  The source also applies `DISTINCT ON`, and selects each key that it does not select otherwise, so that it has a select list, which PostgreSQL requires with `DISTINCT ON`, and evaluates the key once; a field of an aggregate or of `exists` that is a key is a scalar field of the source, as one that the query sorts by.
- A query without nested queries other than such sorted fields and keys, also with queries in the expressions of its fields, which are scalar fields, or without an offset and `distinctOn` keeps its page on its table.
  So does a query of [`distinct`](queries.md#distinct-rows), which compares the values of all its fields to choose the rows of the page, so it evaluates them for every row anyway, and a query with a [row lock](queries.md#row-locks), which locks the rows of its nested queries before its own there.
  So does a query whose nested queries that the page evaluates over its rows hold an `aggregate` node or a SQL fragment that refers to a column of its table at any depth, also in the queries nested in it; a sorted field evaluated in the source is not checked, since the source evaluates it as the query would.
  PostgreSQL assigns an aggregate whose arguments and filter refer only to the sources of an enclosing query to that query, also through a query nested in them, and lowering does not parse SQL fragments to identify their aggregates, so such a fragment or an [aggregate function](queries.md#aggregate-functions), such as `sum` of a column of the parent row, may aggregate the rows of the query before its offset.
  The check is conservative, which costs only the speed of the page: an `aggregate` node whose arguments and filter read both such a column and its own query, such as of `every(field => field.position.eq(form.position))` of a nested query, belongs to its own query, yet keeps the page on its table, since the check does not tell a source of its own query from one of an enclosing query.
  So does a scalar fragment, also one that reads the table only through a query correlated with it, such as ``sql`${field.position} < ${form.fields.count()}` `` of a nested query of fields.
  An aggregate method of only such a column reads it from a derived source, so its `aggregate` node does not refer to the column and leaves the page derived.
- A nested aggregate query without a conversion is selected as a scalar subquery of its statement, decoded by the type of the aggregate, rather than packed: it always returns one row of one value ([decision](../decisions/nested-rows/nested-aggregates-unpacked.md)).
- A nested query of `exists` without a conversion is selected as `EXISTS` of its rows, decoded as a Boolean, rather than packed: it always has one value, which is never `NULL`.
- A nested aggregate query or query of `exists` that [`map` or `transform` converts](queries.md#converting-results) is packed, since only a result plan holds a conversion, whereas a field of a value has only the type that decodes it.
- Nested rows are packed as JSON in the row of their parent and decoded by the result plan of their query, at any depth:
  - Rows `many` are an array, `coalesce(json_agg(...), '[]')`, and the other rows modes are one packed row or `NULL`, which a nested query of rows `one` rejects.
    Several rows of a nested query of one row fail the statement in PostgreSQL with SQLSTATE `21000`, whose error names no field.
  - A packed row is a positional JSON array of the values of the projections in their order, also for a query of values and for a query without projections, whose `[]` differs from a missing row.
    It is smaller and faster to build than an object with keys ([decision](../decisions/nested-rows/packed-rows-as-arrays.md)).
    A row wider than the limit of 100 arguments of a PostgreSQL function is built from an array of JSON values.
  - A scalar value is its PostgreSQL text representation from `format('%s', value)`, which uses the output function of the type, so one `decode` serves the values of a driver row and of a packed row alike, including extension types; an SQL array or a JSON column is a scalar too.
    A cast to `text` is not used: those of `boolean`, `inet`, `cidr`, and `char` differ from their output, such as `true` instead of `t`.
  - SQL `NULL` is JSON `null` through `IS NOT DISTINCT FROM NULL`, since `format` turns it into an empty string, and `IS NULL` also holds for a composite whose fields are all `NULL`.
  - Nested rows stay JSON inside a packed row and never pass through `format`.
  - A row lock of the nested query stays in the derived source that reads its rows, since PostgreSQL rejects it beside the aggregate.
  - Packing reads the projections of the nested query through a derived source, whose expressions are evaluated once per row as long as PostgreSQL does not merge the source into the aggregating query, where packing refers to a scalar twice.
    This relies on the planner, which merges no derived source with `DISTINCT`, `DISTINCT ON`, `GROUP BY`, a row lock, a limit, an offset, or a volatile function in its select list ([PostgreSQL](https://github.com/postgres/postgres/blob/REL_18_6/src/backend/optimizer/prep/prepjointree.c)):
    - A volatile expression, such as `random()`, is evaluated once per row in any derived source.
    - A derived source that selects scalar expressions other than table columns gets `OFFSET 0` unless it has `DISTINCT`, `DISTINCT ON`, `GROUP BY`, a row lock, a limit, or an offset, so that a stable expression, such as a correlated subquery, is not evaluated twice.
      The aggregating query has no conditions of its own, so the barrier keeps nothing from being pushed down, and the conditions of the nested query and their indexes stay inside the source.
      A source of table columns has no barrier ([decision](../decisions/nested-rows/offset-barrier.md)).
  - The order of the query is read from sort keys, projections of the derived source that stay out of the records, so each sort expression is evaluated once:
    - A sort key is the projection that has the value of the sort expression, as for an executed query, or a projection of the sort expression.
    - With a limit or an offset, the derived source sorts by the positions of the sort keys, such as `ORDER BY 2`, so the rows it chooses, their values, and their order in the aggregate come from one evaluation; so it does with `DISTINCT ON`, whose order chooses the first row of each group, and with a [row lock](queries.md#row-locks), which takes the rows in that order; without them, it has no order.
    - Rows `many` are aggregated in the order of the query, since the order of a derived source does not carry into an aggregate: the aggregate sorts by the sort keys with the direction and the placement of `NULL` of the query.
    - The sort keys give the order without numbering the rows, which would be slower and could not sort by a window function ([decision](../decisions/nested-rows/sort-keys-of-packed-rows.md)).
