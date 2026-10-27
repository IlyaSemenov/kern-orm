# SQL generation

- **AST** (`ast/`): the SQL AST, structural expression and statement nodes, and their pure transformations, such as Boolean simplification.
  A select statement nests queries in scalar subqueries, `EXISTS`, and derived sources of `FROM`, plain or `LATERAL`; nodes store no lexical scopes, which the compiler derives from the position of a query in the tree.
- **Lowering** (`lowering/`): turns the semantic node of a query into a SQL select statement of the AST, which the compiler compiles; the compiler knows no relation definitions or semantic query nodes.
  The rows of each nested query become a scalar subquery of their packed rows in place of its field, and a query without nested queries keeps its projections.
  The statement of an executed query sorts by the positions of its projections, while the statement of a nested query keeps its sort expressions, which packing reads.
  For a `Db`, lowering rejects a query of a relation outside its definitions and a nested query bound to another `Db` at any depth.
- **Compiler** (`compiler/postgres/`): turns an AST into SQL text, parameters, and result decoding metadata.
  Parameters and source aliases belong to the whole statement, apart from the lexical scopes that decide which sources a column reference sees.
  Whether an operand needs parentheses depends only on its node kind and its position in the parent, decided in one place.
- **Result** (`result/`): decodes driver rows and packed nested rows by the result plan of a compiled query, and decides which keys a record can have.
  The result plan is internal: `toSQL` and `$compile` return only the text and parameters of a statement.
- **Nested rows** (`lowering/nested.ts`): builds a query that packs the rows of a nested query as JSON, with the result plan that decodes them.

## Statements

- Column references point to an occurrence of a source (`SourceNode`), a table or a derived source, by object identity, never by alias string.
  A reference to a derived source names the key of a projection of its query, never a column of a physical table.
  The compiler gives every occurrence an alias unique in the statement.
- Every identifier the compiler generates, such as an alias or the SQL name of a projection, fits the 63 bytes of a PostgreSQL identifier in any server encoding, since PostgreSQL truncates a longer one ([PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)); a character other than ASCII counts as 4 bytes, the most it takes in a server encoding.
  - An alias is the name of its table, or `subquery`, cut to 50 bytes and numbered when the statement already has it.
  - Rows are decoded by position, so the key of a result field stays apart from the SQL name of its projection, which only a reference through a derived source uses.
    A key of up to 50 bytes is the name itself, and a longer key is named by its prefix of more than 50 bytes and its position, so the names of the projections of a query differ.
- A column reference resolves to a source visible from its position, as in PostgreSQL ([PostgreSQL](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-LATERAL)); the compiler rejects any other reference, including one to a source that has an alias elsewhere in the statement, such as in a sibling subquery:
  - the select list, `WHERE`, `ORDER BY`, and the subqueries in them see the sources of their query and of enclosing queries;
  - the `ON` condition of a join sees the sources up to the joined one;
  - a plain derived source sees only the sources of enclosing queries, and a `LATERAL` one also the sources before it in the same `FROM`;
  - `LIMIT` and `OFFSET` see only the sources of enclosing queries.
- Every place of a source in a statement is its own occurrence: a query inserted twice declares its sources twice under different aliases.
  A source that appears where it is already visible, such as a query nested in itself or a source joined twice, is rejected, since its column references would be ambiguous; a nested query over the same table starts from its own `from`.
- A scalar subquery selects exactly one field.
- An executed query sorts by the position of the projection that has the value of a sort expression, such as `ORDER BY 2`, and by other expressions as they are; a nested query sorts by its sort keys as packing describes, with the same rule of which projection has the value.
  Only a projection of the same column or of the same expression node is guaranteed to have the value of a sort expression.
  A selected expression repeated in `ORDER BY` would get parameters of its own: the statement would send their values twice, and PostgreSQL would evaluate it again unless it finds the two expressions equal, which it does once a custom plan folds the parameters into constants but not in a generic plan, such as of a prepared statement.

## Result decoding

- Result decoding rejects a driver row or a packed row that does not match the result fields instead of reading a missing value as `NULL`.
  A query of one row rejects more than one row, since it may have no limit; a `NULL` value of a query of values is `null`, not a missing row.

## Nested rows

- A nested query is selected as a scalar subquery of its packed rows rather than as a `LATERAL` join: PostgreSQL evaluates a scalar subquery of the select list after the sort and the limit of the parent, while it joins a `LATERAL` subquery to every row before them unless an index gives the order.
  On a page of 20 of 1000 parents ordered by a column without an index, the scalar subquery is 38 to 48 times faster, and the two are within 8% for all parents and for a page ordered by an index ([benchmark](../benchmarks/suites/nested-placement.ts)).
- Nested rows are packed as JSON in the row of their parent and decoded by the result plan of their query, at any depth:
  - Rows `many` are an array, `coalesce(json_agg(...), '[]')`, and the other rows modes are one packed row or `NULL`, which a nested query of rows `one` rejects.
    Several rows of a nested query of one row fail the statement in PostgreSQL with SQLSTATE `21000`, whose error names no field.
  - A packed row is a positional JSON array of the values of the projections in their order, also for a query of values and for a query without projections, whose `[]` differs from a missing row.
    On records of 3 to 30 fields, PostgreSQL builds it 23 to 35% faster than an object with keys, and it is 40 to 48% smaller ([benchmark](../benchmarks/suites/nested-transport.ts)).
    A row wider than the limit of 100 arguments of a PostgreSQL function is built from an array of JSON values.
  - A scalar value is its PostgreSQL text representation from `format('%s', value)`, which uses the output function of the type, so one `decode` serves the values of a driver row and of a packed row alike, including extension types; an SQL array or a JSON column is a scalar too.
    A cast to `text` is not used: those of `boolean`, `inet`, `cidr`, and `char` differ from their output, such as `true` instead of `t`.
  - SQL `NULL` is JSON `null` through `IS NOT DISTINCT FROM NULL`, since `format` turns it into an empty string, and `IS NULL` also holds for a composite whose fields are all `NULL`.
  - Nested rows stay JSON inside a packed row and never pass through `format`.
  - Packing reads the projections of the nested query through a derived source, whose expressions are evaluated once per row as long as PostgreSQL does not merge the source into the aggregating query, where packing refers to a scalar twice.
    This relies on the planner, which merges no derived source with a limit, an offset, or a volatile function in its select list ([PostgreSQL](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/optimizer/prep/prepjointree.c)):
    - A volatile expression, such as `random()`, is evaluated once per row in any derived source.
    - A derived source that selects scalar expressions other than table columns gets `OFFSET 0` unless it has a limit or an offset, so that a stable expression, such as a correlated subquery, is not evaluated twice.
      The aggregating query has no conditions of its own, so the barrier keeps nothing from being pushed down, and the conditions of the nested query and their indexes stay inside the source.
      A source of table columns has no barrier, which would add up to 8% there; with `md5` of each column instead, the barrier makes the query 38 to 45% faster ([benchmark](../benchmarks/suites/offset-barrier.ts)).
  - The order of the query is read from sort keys, projections of the derived source that stay out of the records, so each sort expression is evaluated once:
    - A sort key is the projection that has the value of the sort expression, as for an executed query, or a projection of the sort expression.
    - With a limit or an offset, the derived source sorts by the positions of the sort keys, such as `ORDER BY 2`, so the rows it chooses, their values, and their order in the aggregate come from one evaluation; without them, it has no order.
    - Rows `many` are aggregated in the order of the query, since the order of a derived source does not carry into an aggregate: the aggregate sorts by the sort keys with the direction and the placement of `NULL` of the query.
    - Numbering the rows with `row_number()` in the derived source and aggregating by the number would be 8 to 26% slower ([benchmark](../benchmarks/suites/sort-keys.ts)), and could not sort by a window function, which PostgreSQL rejects in a window definition.
  - A decoding error names the path of the value from its result field, such as `fields[2].label`.
