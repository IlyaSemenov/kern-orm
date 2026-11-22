# Column naming conventions of the table factory

`createTableFactory` takes the conversion of column keys to physical names, such as `toSnakeCase`, as an option of the definition of tables and views rather than of a database.

```ts
// kern-orm: the factory that defines tables and views
export const { defineTable, defineView } = createTableFactory({ columnName: toSnakeCase })

// Drizzle ORM: the database
const db = drizzle({ connection: process.env.DATABASE_URL, casing: "snake_case" })
```

- Drizzle ORM has `casing` in the options of `drizzle` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/utils.ts)), and its documentation describes the builder `snakeCase.table` ([docs](https://orm.drizzle.team/docs/sql-schema-declaration#camel-and-snake-casing)).
