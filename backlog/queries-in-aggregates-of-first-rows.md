# Queries in aggregates of first rows

An aggregate method of a query of [`distinctOn`](../architecture/queries.md#first-row-of-each-group) whose argument holds a query, such as the sum of the numbers of the fields of the latest version of each form, evaluates the query for every row that `DISTINCT ON` reads, since its derived source selects the argument.

- A source of the first rows that selects the columns that the argument reads and replaces the table, as `lowerPage` does, would let the aggregate evaluate the argument only over the first rows.
- An argument that may aggregate the rows, such as an aggregate function of a query of groups or a SQL fragment of the columns, must stay in the source, as `mayAggregateSource` tells for a page.
