# Name of the negative inner product

`negativeInnerProduct` is the SQL `<#>` of pgvector as it is: the inner product with its sign changed, so that the most similar vectors come first in ascending order, which an index of pgvector reads.

```ts
// Chosen: the value of `<#>`, named by its sign
documents.orderBy(document => document.embedding.negativeInnerProduct(embedding))

// Alternative: the name of the measure, of the same value
documents.orderBy(document => document.embedding.innerProduct(embedding))

// Alternative: the inner product itself, `(embedding <#> $1) * -1`
documents.orderBy(document => desc(document.embedding.innerProduct(embedding)))
```

- `innerProduct` of the value of `<#>` names the measure that users look for, as the other distances do, and Drizzle ORM chose it ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/functions/vector.ts)).
  Its value has the opposite sign of its name, so a condition such as `innerProduct(embedding).gt(0.8)` keeps the least similar rows.
- `maxInnerProduct`, the name of pgvector-node for its helpers of Kysely, Knex, MikroORM, and Sequelize ([source](https://github.com/pgvector/pgvector-node/blob/v0.3.1/src/kysely/index.js)), tells the order that `<#>` sorts by, but not the value that a query selects or compares.
- An `innerProduct` that negates `<#>` gives the inner product itself, but a query sorts by it in descending order, by an expression that is not the operator, which no index of pgvector reads.
- The chosen name is the one of the documentation of pgvector, longer than the others, and tells both the value and the order.
