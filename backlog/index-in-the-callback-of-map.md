# Index in the callback of `map`

The callback of `map` takes only the record or the value; it should take the arguments of `Array.map`, with the index, as in Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#map)).

A query of one row passes the index 0, such as `take` after a helper that maps the records.
