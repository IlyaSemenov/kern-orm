# First rows in another order

Rows of [`distinctOn`](../architecture/queries.md#first-row-of-each-group) in an order that does not start with its keys, such as the latest submission of each user, newest first, which lowering rejects, since PostgreSQL requires the order of `DISTINCT ON` to start with its keys.

- A derived source of the first rows, sorted by the keys and then by the order of the query, read in the order of the query with its limit and offset, gives them; an order that starts with the keys keeps one statement.
- It only turns orders that lowering rejects into valid ones, so no query that runs changes.
