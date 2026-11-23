# Read expression declared by a type

PostgreSQL returns a value as text, and for some types the text of the value is the wrong thing to decode: the text of `timestamptz` depends on the session setting `DateStyle`, which a library that runs on the connections of an application cannot require to be `ISO`, and a `geometry` of PostGIS reads as hex EWKB unless the statement selects `ST_AsGeoJSON` of it.
A type declares the SQL expression that reads its values, as SQL text, and its `decode` decodes the result of the expression:

```ts
const instant = defineType({
  sqlType: "timestamptz",
  read: value => `extract(epoch from ${value})`,
}).transform({
  decode: seconds => new Date(Math.round(Number(seconds) * 1000)),
  encode: (value: Date) => value.toISOString(),
})
```

Every place that returns a value of the type selects it by the expression: the columns of a record of a statement of SQL text, and the queries of the ORM in their select lists, `RETURNING`, and packed nested rows.
The function writes the value once in the expression, so that a statement does not evaluate at two places a value that it reads; `defineType` checks it for a sample value.
The option is named `read`, so that an expression that writes a parameter of the type, such as `ST_GeomFromGeoJSON($1)`, fits beside it as `write`.

The alternatives:

- A `read` option of the columns of a record, such as `columnsOf(db.job, { read: { runAt: value => ... } })`, would not change the contract of `Type` and would cost only the code of the columns.
  But each use of the columns would repeat it, a type that decodes its result would decode nothing else, and a query of the table of such a column would return the text of the value to that decoder.
- A second decoder of a built-in type, such as of `timestamptz`, for the result of an expression that the library chooses, would need no type of the user.
  But the type would decode two texts, by the place that returns its value, and the SQL of existing queries would change or the two decoders would have to agree on every value.
- A function of `sql` fragments, `` value => sql`extract(epoch from ${value})` ``, would build the expression as other SQL is built, and could name an object with `identifier`.
  But `defineType` of the ORM takes the same options, and `sql` of the ORM creates an expression, which the database layer cannot render, so the option would need `sql` of `kern-orm/db` inside a call of a function of `kern-orm`; a fragment could hold a parameter, which the text of the columns of a record cannot have; and the other SQL of a type, its `sqlType`, its `castType`, and the format of `withParameters`, is text already.
  A name known only at runtime takes `quoteIdentifier` of `kern-db/builder`.
- Applying the expression wherever a query refers to the value, also in conditions and sort keys, as MikroORM does, needs no rule of where a value leaves a statement.
  But a condition would compare, and an order would sort by, the result of the expression, such as the text of GeoJSON, which an index of the column may not serve.
- Reading an `array` of such a type by the expression of its elements, such as `ARRAY(SELECT read(e) FROM unnest(value) e)`, would let a column of an array keep the type of its elements.
  It is rejected instead: the order and the `NULL` elements of such a subquery need care that no application has asked for.
