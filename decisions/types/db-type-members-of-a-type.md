# Members of the type of `kern-db` declared again in the type of the ORM

A type of the ORM is a type of `kern-db` by its members rather than by inheritance.
`Type` of the ORM declares the members of `Type` of `kern-db` and the methods that derive a type, `nullable`, `transform`, `of`, `withParameters`, and `with`, itself, as a derivable type of `kern-db` declares its own:

```ts
// kern-orm
interface BaseType<Output, Input, Operators, Parameters> {
  readonly [typeValues]: { output: Output; input: Input }
  readonly encode: (value: NonNullable<Input>) => string
  // ...
  nullable(): Type<Output | null, Input | null, Operators, Parameters>
}

// kern-db
interface BaseDerivableType<Output, Input, Parameters> extends Type<Output, Input> {
  nullable(): DerivableType<Output | null, Input | null, Parameters>
}
```

The rules of their value types, `AcceptedValues`, `AcceptedNull`, and `TypeTransform`, are written once, in the module of types of `kern-db`, and type tests check that a type of the ORM is assignable to `Type` of `kern-db`.
Building the types of the ORM on those of `kern-db` this way added no instantiations to a type derived in user code and to an expression of a type ([benchmark](../../benchmarks/types/types.bench.ts)).

The alternatives:

- `BaseType extends DbType`, which declares the members of the contract once and states that a type of the ORM is a type of `kern-db`.
  It adds 3 instantiations to each type derived in user code and to `param` of a type, and 6 to `sql` of a type and to an array type: 14 instead of 11 for `nullable`, 15% for `of` and `param`, 20% for `sql` of a type, and 5.8% for a table of four derived columns.

- The signatures of the methods shared through a higher-kinded type: an interface of the module of types of `kern-db` that both a derivable type of `kern-db` and a type of the ORM extend, whose methods return the type of a kind, so that the five signatures are written once:

  ```ts
  interface TypeDerivations<Output, Input, Parameters, K extends TypeKind> {
    nullable(): DerivedType<K, Output | null, Input | null, Parameters>
  }

  interface OrmTypeKind<Operators> extends TypeKind {
    readonly type: Type<this["output"], this["input"], Operators, this["parameters"]>
  }
  ```

  Each call then resolves the kind: 31 instantiations instead of 11 for `nullable`, 46 instead of 20 for `of`, 69% to 83% more for `transform`, 29 times more for `with`, and 3.9 times more for a table of four derived columns.
