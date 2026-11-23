# Read expression of a type

A custom type that declares the SQL expression by which its values are read, such as `extract(epoch from column)` of a `timestamptz` whose `decode` then does not depend on `DateStyle`, or `ST_AsGeoJSON(column)` of a `geometry` of PostGIS, so that every place that returns a value of the type selects it by the expression and decodes its result.

- Preliminary decision: the expression belongs to the type of the database layer rather than to an option of the [columns of a record](../architecture/sql-queries.md#columns-of-records), so that it is declared once and queries of tables read it too, and `decode` of the type decodes the result of the expression, as its only decoder.
  `transform`, `nullable`, `of`, and `with` keep the expression, and the built-in types have none.
- The columns of a record select a column of such a type by its expression, and so do the results of the ORM: the select list, `RETURNING`, and the values of [packed nested rows](../architecture/sql.md), which `format('%s', value)` reads.
  A value that a statement only computes with, such as in a condition, a sort key, or a derived source, keeps its PostgreSQL type.
- A statement of SQL text written by hand must select the expression itself for a field of such a type, as `select` cannot check what a statement returns.
- Decide how a query sorts by a field of such a type: an executed query sorts by the position of a projection that its sort key matches, which would sort by the result of the expression, such as the text of GeoJSON, and `SELECT DISTINCT` takes a sort key only from its select list.
- Decide what `array` of such a type does, since the expression does not apply to the elements of an array; rejecting it is the preliminary decision.
- The expression must return `NULL` for `NULL`, since `decode` never receives it.
  The columns of a record tell a missing row by the `NULL` of the columns of their key or of `by`, so the expression of such a column must also return a value other than `NULL` for every value other than `NULL`, which `NULLIF(column, 0)` does not; decide whether a column of the key or of `by` may have such a type.
- Decide whether a type also declares the expression that writes its parameter, such as `ST_GeomFromGeoJSON($1)`, and name the read expression so that it fits.
- Record in [comparison/](../comparison/README.md) how other libraries pair SQL expressions with the conversion of a type, such as the custom types of MikroORM and Doctrine.
