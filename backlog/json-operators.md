# JSON operators

Operators of `json` and `jsonb` expressions typed by the shape of `of<T>()`, such as `->` and `->>` of a key, to filter by a property, such as `config->>'fieldType' = 'rate'`, and functions of JSON paths, such as `jsonb_path_query_first`, as Orchid ORM 1.78.47 has them ([operators](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/where.md#jsonb-column-operators), [functions](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/json.md)).

- Decide the type of `->>` of a property that is not a string, which PostgreSQL gives as text.
- A missing property is `NULL` whatever the shape, which kern-orm does not validate, so decide whether an expression of a required property is nullable.
- An operator of a JSON `null` value, such as `isJsonNull()`, by `json_typeof` of a `json` value and `jsonb_typeof` of a `jsonb` value: PostgreSQL has no `=` for `json`, so a `json` column, also of `jsonWithJsonNull`, finds its JSON `null` values only by a `sql` fragment.
  - Decide which JSON types have it: those of the marker `jsonNull` alone, or `json` and `jsonb` too.
  - Decide what it gives for `NULL`: `json_typeof(value) = 'null'` is `NULL`, also under `NOT`, and `(json_typeof(value) = 'null') IS TRUE` is `FALSE`; a condition selects the same rows for both, while its negation and a selected field differ.
