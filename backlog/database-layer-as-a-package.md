# Database layer as a package

The [database layer](../architecture/README.md#layers) as the package `kern-db`, so that drivers, the migrator, and code without the ORM, such as a runner of jobs, use it without `kern-orm`.

## Preliminary decisions

- Code joins an ambient transaction through the instance of `Database` that it is given, not through a single copy of a package: the coordinator of each instance has its own async context.
- The ORM keeps its AST, lowering, and compiler, and its expressions with operators; the layer compiles only its SQL fragments: text, parameters, quoted names, and nested fragments.
- The layer has `sql`, `identifier`, and `param(codec, value)` of its own, which create SQL fragments without operators; the ORM keeps functions of the same names that create expressions, and builds them on the fragments of the layer, so that quoting and encoding are written once.
- The ORM interpolates a fragment of the layer, also into `sql` and `$query`, and compiles it in its own context of parameters, which numbers the parameters across the statement and binds the parameter of `param` once in a query of groups; the layer never interpolates an expression of the ORM.
- A template of the layer takes values without a codec only of `string`, `number`, `bigint`, `boolean`, `null`, `Date`, and `Uint8Array`, its fragments, and nothing else, such as an object, an array, or an expression of the ORM: their types reject the others, and the template rejects them when it is created, with an error that names no ORM.
  JSON and arrays take `param` with a codec.
  The ORM encodes its untyped parameters by the same rule.
- `script` of the layer compiles its template with the same renderer and rejects a parameter at any depth before the driver gets the script.
- The layer takes a [type](../architecture/types.md) of the ORM wherever it takes a codec, such as in `get(t.uuid)`.
- Until the package exists, `kern-orm/db` also exports the rest of the layer, such as `Database`, the driver contract, and its errors, as `kern-db` will: the root of `kern-orm` exports the functions of the ORM of the same names.
- A query of SQL text of the layer holds the source of its statement apart from the plan of its result, which `select`, `get`, `pluck`, `take`, `optional`, and `nullable` change.
  `$query` of a `Db` creates it with the compilation of that `Db`, which resolves a dynamic PostgreSQL schema when the query compiles.
- The layer decodes flat results; the ORM keeps nested rows, required relations, literals, `map`, and `transform`.
- The errors of drivers keep their brands of `Symbol.for`, so that a driver and the coordinator of different packages recognize each other's errors.
- Drivers and the migrator depend on `kern-db`; renaming their packages is a separate decision.

## Steps

1. Done: the contract of codecs and the codecs of the built-in types, exported from `kern-orm/db` and `kern-orm/db/types`, and `Type` built on them.
2. Queries of SQL text in the layer: the untyped parameters of the ORM by the rule of the layer, and the decoding of flat results; `query` and the template of `script` move from `execution/database.ts` to the layer, `kern-orm/db` exports its fragments, and the documentation of migrations uses its fragments and codecs.
   Done: its fragments and the renderer of templates, which the ORM interpolates.
3. The driver contract and the tests of the layer on its own API, without tables and the expressions of the ORM.
4. The package: its entry points, the dependencies of drivers and the migrator, the compatibility test, and a consumer that installs `kern-db`, a driver, and the migrator without `kern-orm`.

## Open questions

- How an application binds a schema without `bind` of the `Database` of the layer, such as with a function of `kern-orm`, and whether `kern-orm` keeps a `Database` with `bind`.
- Whether `coordinator` stays a member of `Database`: its class has private fields, which make the types of two copies of `kern-db` incompatible, while the test helpers need only a few of its methods.
- Which range of `kern-db` `kern-orm` and the companion packages require, and which compatibility contract the new package keeps.
  A codec of one copy of `kern-db` is not a codec for another: at runtime by the brand of its module, and in types by the `unique symbol` key of its value types.
- How `$execute` and `$compile` of a `Db` reject a query of SQL text of another `Db` once such a query holds no node of the ORM.
