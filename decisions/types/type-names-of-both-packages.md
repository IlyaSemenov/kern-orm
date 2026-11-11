# One name for the types of both packages

`kern-db` and `kern-orm` name their type `Type` and the function that defines it `defineType`, as `kern-db/types` and `kern-orm/types` export their built-in types under the same names.
A type of the ORM is a type of `kern-db` with operators and the factories of columns, so both are one concept, and the entry point that a module imports from tells which it is:

```ts
import { defineType as defineDbType } from "kern-db"
import { defineType, orderingOperators } from "kern-orm"

const ltree = defineDbType({ sqlType: "ltree" })
const orderedLtree = defineType(ltree).withOperators(orderingOperators)
```

The cost is two functions `defineType` in `kern-orm`, at its root and in `kern-orm/db`, which re-exports `kern-db`.
An editor offers both to import, and a type of `kern-db` taken for one of the ORM has no operators, so the errors of the ORM that reject it name `kern-orm/types` and `defineType` of `kern-orm`, and the errors of `defineType` of `kern-db` name `kern-db`.
The ORM imports the names of `kern-db` that it declares itself under the prefix `Db`, such as `DbType`, and its root re-exports only the other types of `kern-db`, such as `TypeOptions`.

The alternatives:

- `Codec`, the conversion between JavaScript values and their PostgreSQL text representation.
  The type also has the SQL type names, type parameters, nullability, and the methods that derive types, so it is more than a codec, and the pages of the site would explain why the type of `kern-db` has another name.

- `SqlType`, a name of its own beside `SqlFragment` and `SqlQuery` of `kern-db`, which `kern-orm` could re-export at its root and which no editor confuses with `Type` of the ORM.
  A user of `kern-db` alone would read a prefix that tells it apart only from the ORM, and `sqlType` of a `SqlType`, its SQL type name, would repeat it.
