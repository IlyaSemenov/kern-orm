# Database layer as a package

The [database layer](../architecture/README.md#layers) as the package `kern-db`, so that drivers, the migrator, and code without the ORM, such as a runner of jobs, use it without `kern-orm`.

## Preliminary decisions

- Code joins an ambient transaction through the instance of `Database` that it is given, not through a single copy of a package: the coordinator of each instance has its own async context.
- The ORM keeps its AST, lowering, and compiler; the layer compiles only its SQL templates: text, parameters, quoted names, and nested fragments.
- A codec is the contract of the layer: its SQL type and cast type, encoding, decoding, and nullability.
  A `Type` of the ORM is a codec with operators and the factories of columns, and the layer takes it wherever it takes a codec, such as in `get(t.uuid)`.
- A query of SQL text of the layer holds the source of its statement apart from the plan of its result, which `select`, `get`, `pluck`, `take`, `optional`, and `nullable` change.
  `$query` of a `Db` creates it with the compilation of that `Db`, which resolves a dynamic PostgreSQL schema when the query compiles.
- The layer decodes flat results; the ORM keeps nested rows, required relations, literals, `map`, and `transform`.
- The errors of drivers keep their brands of `Symbol.for`, so that a driver and the coordinator of different packages recognize each other's errors.
- Drivers and the migrator depend on `kern-db`; renaming their packages is a separate decision.

## Steps

1. The contract of codecs, and `Type` built on it.
2. Queries of SQL text in the layer: `sql` fragments, `identifier`, parameters of a codec, the compiler of templates, and the decoding of flat results; `query` and the template of `script` move from `execution/database.ts` to the layer.
3. The driver contract and the tests of the layer on its own API, without tables and the expressions of the ORM.
4. The package: its entry points, the dependencies of drivers and the migrator, the compatibility test, and a consumer that installs `kern-db`, a driver, and the migrator without `kern-orm`.

## Open questions

- Whether the layer offers only templates with values, `identifier`, and parameters of a codec, or also the expressions and operators of the ORM: `query` of a `Database` takes expressions of the ORM now, such as `identifier` of `kern-orm` in migrations.
- How an application binds a schema without `bind` of the `Database` of the layer, such as with a function of `kern-orm`, and whether `kern-orm` keeps a `Database` with `bind`.
- Whether `coordinator` stays a member of `Database`: its class has private fields, which make the types of two copies of `kern-db` incompatible, while the test helpers need only a few of its methods.
- Which range of `kern-db` `kern-orm` and the companion packages require, and which compatibility contract the new package keeps.
- How `$execute` and `$compile` of a `Db` reject a query of SQL text of another `Db` once such a query holds no node of the ORM.
