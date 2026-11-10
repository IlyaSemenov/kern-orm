# Members of a codec declared again in `Type`

A `Type` is a codec of the database layer by its members rather than by inheritance.
`Type` declares the members of `Codec` and the methods that derive a type, `nullable`, `transform`, `of`, `withParameters`, and `with`, itself, as a derivable codec declares its own:

```ts
interface BaseType<Output, Input, Operators, Parameters> {
  readonly [codecValues]: { output: Output; input: Input }
  readonly encode: (value: NonNullable<Input>) => string
  // ...
  nullable(): Type<Output | null, Input | null, Operators, Parameters>
}

interface BaseDerivableCodec<Output, Input, Parameters> extends Codec<Output, Input> {
  nullable(): DerivableCodec<Output | null, Input | null, Parameters>
}
```

The rules of their value types, `AcceptedValues`, `AcceptedNull`, and `CodecTransform`, are written once, in the module of codecs, and type tests check that a type is assignable to `Codec`.
Building types on codecs this way added no instantiations to a type derived in user code and to an expression of a type ([benchmark](../../benchmarks/types/types.bench.ts)).

The alternatives:

- `BaseType extends Codec`, which declares the members of the contract once and states that a type is a codec.
  It adds 3 instantiations to each type derived in user code and to `param` of a type, and 6 to `sql` of a type and to an array type: 14 instead of 11 for `nullable`, 15% for `of` and `param`, 20% for `sql` of a type, and 5.8% for a table of four derived columns.

- The signatures of the methods shared through a higher-kinded type: an interface of the module of codecs that both a derivable codec and a type extend, whose methods return the codec of a kind, so that the five signatures are written once:

  ```ts
  interface CodecDerivations<Output, Input, Parameters, K extends CodecKind> {
    nullable(): DerivedCodec<K, Output | null, Input | null, Parameters>
  }

  interface TypeKind<Operators> extends CodecKind {
    readonly codec: Type<this["output"], this["input"], Operators, this["parameters"]>
  }
  ```

  Each call then resolves the kind: 31 instantiations instead of 11 for `nullable`, 46 instead of 20 for `of`, 69% to 83% more for `transform`, 29 times more for `with`, and 3.9 times more for a table of four derived columns.
