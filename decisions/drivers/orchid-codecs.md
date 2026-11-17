# Reusing Orchid's postgres.js codecs

The Orchid adapter serializes parameters and parses results with the serializer and parser registries of the configured postgres.js 4 client.
postgres.js serializes the parameters of an Orchid statement by the types that PostgreSQL resolves for them ([decision](orchid-values.md)), and the executor parses the text results of Kern by their result column OIDs.

A handwritten set of codecs could avoid retaining a postgres.js client when Kern uses node-postgres.
It would also need to duplicate Orchid's interval and timestamp representations, postgres.js's array escaping and delimiters, database-defined arrays and domains, and application codecs.
Reusing the configured registries keeps those rules in their existing implementation, at the cost of requiring that client's type initialization and constraining the adapter to postgres.js 4.

Even a result's OID cannot identify the type of a parameter: `SELECT ($1::jsonb)->>0` returns text.
