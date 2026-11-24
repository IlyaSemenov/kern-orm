# Filters and expressions

## Empty groups of conditions

An empty group of conditions compiles to valid SQL beside the conditions around it.

- Orchid ORM, fails: `orWhere` with only `undefined` values left a dangling `OR` in invalid SQL ([orchid-orm#850](https://github.com/romeerez/orchid-orm/issues/850)).

## `IN` of an empty list

`in([])` is `FALSE`, and the other branch of an `OR` stays.

- Orchid ORM, fails: `whereNotIn`, `orWhereIn`, and `orWhereNotIn` of an empty list returned nothing, dropping the other branch ([orchid-orm#842](https://github.com/romeerez/orchid-orm/issues/842)).

## Operators of a query of one value

The operators of the value of a query are those of the expression that `expr` gives, such as `form.fields.count().expr().gt(3)`.

- Orchid ORM 1.78.37, differs: the operators are methods of the query, such as `q.sum("points").gt(0)` ([docs](https://github.com/romeerez/orchid-orm/blob/c4d62ea0e82f6d06c3b715fcf790113b2921a7ba/docs/src/guide/aggregate.md)).

## Arithmetic of expressions

Number types have `add`, `sub`, `mul`, and `div`, and integers and `numeric` also `mod`, whose result has the type of the expression they are called on, such as `item.price.mul(item.quantity)`.

- Kysely, same: `eb(lhs, op, rhs)` takes an arithmetic operator, such as `eb('age', '+', 1)`, and types the result by the reference on the left ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/expression/expression-builder.ts#L172-L190)).
- Drizzle ORM, lacks: its operators compare values, and a `sql` fragment writes arithmetic ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/expressions/conditions.ts)).

## Vectors of pgvector

`vector` of pgvector is a built-in type of arrays of numbers, whose distances are operators that compile to the operators of pgvector, such as `document.embedding.cosineDistance(embedding)` to `embedding <=> $1`, with the result of `double precision`.

- Drizzle ORM, same: `vector` of `pg-core` with required `dimensions`, of `number[]`, and the functions `l2Distance`, `innerProduct`, `cosineDistance`, `l1Distance`, `hammingDistance`, and `jaccardDistance` of a column and an array compile to the operators, `innerProduct` to `<#>` without changing its sign ([column](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/vector_extension/vector.ts), [functions](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/functions/vector.ts)).
- pgvector-node, differs: a package of its own adds the types and the functions of distances to Kysely, Knex, MikroORM, and Sequelize, which take a column by its name, and names `<#>` `maxInnerProduct` ([source](https://github.com/pgvector/pgvector-node/blob/v0.3.1/src/kysely/index.js)).
- TypeORM, lacks: a column of `vector` with `length` reads `number[]`, and a query sorts by a distance in a SQL string of `orderBy` ([docs](https://github.com/typeorm/typeorm/blob/1.1.3/docs/docs/entity/1-entities.md#vector-columns)).
- Prisma ORM, lacks: a column of `vector` is `Unsupported("vector(3)")`, which the client leaves out, so queries of it are SQL text ([issue](https://github.com/prisma/orm/issues/18442)).
- Orchid ORM pqb 0.73.49, lacks: a column of `vector` is a custom type, `t.type('vector(3)')`, of `unknown` values without operators ([source](https://github.com/romeerez/orchid-orm/blob/69c1e00283a9c08d1422d1dae6e6ef9caa52fd38/packages/pqb/src/columns/column-types/custom-type.ts)).

## Identifiers in SQL fragments

`identifier` is a function of its own, as `sql` and `param` are.

- Drizzle ORM, differs: `sql.identifier` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts)).
- Slonik, differs: `sql.identifier` ([docs](https://github.com/gajus/slonik/blob/slonik@49.13.0/README.md#sqlidentifier)).
- Kysely, differs: `sql.id` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L271)).

## Lists of SQL fragments

`joinSql` is a function of its own that joins fragments and values into one fragment, by `, ` or by a separator fragment, making each value a parameter, and rejects an empty array when it is called.

- Drizzle ORM, differs: `sql.join` takes fragments and parameters, joins them by nothing without a separator, and returns empty SQL for an empty array ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts#L516-L537)).
- Slonik, differs: `sql.join` requires its separator, and `sql.list` joins by `, `; both take fragments and values, and reject an empty array when the statement compiles ([source](https://github.com/gajus/slonik/blob/slonik@49.13.0/packages/sql-tag/src/sqlFragmentFactories/createListSqlFragment.ts#L18-L37), [docs](https://github.com/gajus/slonik/blob/slonik@49.13.0/README.md#L1977-L1986)).
- Kysely, differs: `sql.join` takes fragments, queries, and values, joins them by `` sql`, ` `` by default, and returns empty SQL for an empty array ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L443-L462)).
- Prisma ORM, differs: `Prisma.join`, the `join` of sql-template-tag 5.2.1, takes fragments and values, joins them by the text of a string separator, `","` by default, and rejects an empty array when it is called ([source](https://github.com/blakeembrey/sql-template-tag/blob/v5.2.1/src/index.ts#L103-L121), [re-export](https://github.com/prisma/prisma/blob/7.10.1/packages/client-runtime-utils/src/index.ts#L4)).
