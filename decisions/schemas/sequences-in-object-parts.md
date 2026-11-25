# Sequences in object parts of a schema

An object part of `defineSchema` holds tables and sequences, such as `defineSchema({ form, formNumberSeq: defineSequence("form_number_seq") })`, and the types of the schema give the tables in `$tables` and the sequences in `$sequences`.
The type of a part without sequences gives its tables as the part itself, and only a part with a sequence splits its keys by the kind of their objects, with `Pick` of the keys of each kind:

```ts
type ReadObjects<P> = [Extract<P[keyof P], AnySequence>] extends [never]
  ? { tables: P; relations: EmptyRecord; sequences: EmptyRecord }
  : { tables: Pick<P, TableKeys<P>>; relations: EmptyRecord; sequences: Pick<P, SequenceKeys<P>> }
```

Splitting the keys of every part by a mapped type with an `as` clause, `{ [K in keyof P as P[K] extends AnySequence ? never : K]: P[K] }`, is one type for both cases, but TypeScript then instantiates the queries of a `Db` of the schema again, such as their results.
The [type benchmarks](../../benchmarks/types/) of a schema without sequences measured, before sequences, with that split, and with the chosen type:

- `first query of a deep relation graph`: 7240, 18975 (+162%), and 7240 instantiations;
- `value of an aggregate of a relation`: 396, 788 (+99%), and 396;
- `find`: 226, 290 (+28%), and 226; `count`: 142, 184 (+30%), and 142; `aggregate with a fallback`: 274, 366 (+34%), and 274;
- `schema with relations`: 1194, 1378 (+15%), and 1223 (+2.4%), the check of the values of each part against `AnySequence`.

A schema with a sequence pays for the split of the parts that hold one.
The type parameter of the sequences of `Schema` and `Db` adds 335 instantiations to the first comparison of two `Db` types, such as of a `Db` assigned to a `DbOf`, with 2 tables as with 12, in either design.
