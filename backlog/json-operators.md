# JSON operators

Operators of `json` and `jsonb` expressions typed by the shape of `of<T>()`, such as `->` and `->>` of a key, to filter by a property, such as `config->>'fieldType' = 'rate'`, and functions of JSON paths, such as `jsonb_path_query_first`, as Orchid ORM 1.78.47 has them ([operators](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/where.md#jsonb-column-operators), [functions](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/json.md)).

- Decide the type of `->>` of a property that is not a string, which PostgreSQL gives as text.
- A missing property is `NULL` whatever the shape, which kern-orm does not validate, so decide whether an expression of a required property is nullable.
