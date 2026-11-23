# Write expression of a type

A custom type that declares the SQL expression by which its parameters are written, such as `ST_GeomFromGeoJSON($1)` of a `geometry` of PostGIS, beside its [read expression](../architecture/types.md), so that `encode` of the type returns the text that the expression takes rather than the text of the PostgreSQL type.

- Preliminary decision: the option `write` of `defineType`, a function of SQL text as `read` is, from the SQL of the placeholder of a parameter to the SQL that writes it.
- Decide where it applies: a parameter of `param` with the type, a compared value, an insert or update value, and a value of an array of the type, whose elements it does not reach.
- Decide how it combines with the cast of `param` to the cast type of the type, which the expression may replace.
- MikroORM has it: `convertToDatabaseValueSQL(key, platform)` of a custom type returns the SQL that writes a value for the SQL of its placeholder ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/core/src/types/Type.ts#L48-L53)).
- Doctrine ORM 3.8.0 with Doctrine DBAL 4.6.0 has it: `convertToDatabaseValueSQL($sqlExpr, $platform)` of a type ([source](https://github.com/doctrine/dbal/blob/4.6.0/src/Types/Type.php#L227-L241)) wraps the placeholder of a parameter, such as of a query ([source](https://github.com/doctrine/orm/blob/3.8.0/src/Query/SqlWalker.php#L2267-L2281)).
