// Columns selected by a list of keys whose types may not tell each key: which of them the record of a row is guaranteed to have, such as of `select` of kern-orm by keys and of the columns of a record in SQL text.

/** Tells whether a record keyed by `K` can omit every property, as with a string or template index signature. */
export type IsIndexKey<K extends PropertyKey> =
  // No member inherited from Object can satisfy a required property of type never.
  {} extends Record<K, never> ? true : false

/** Tells whether `T` is a union of several types. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : false

/** Tells whether `K` can name more than one column, as with a union or an index signature. */
type IsDynamicColumn<K extends PropertyKey> = IsIndexKey<K> extends true ? true : IsUnion<K>

/** Keys of the columns that individual elements of one list `Keys` guarantee, including fixed elements on either side of a spread, added to `Found`. */
type GuaranteedKeysOfList<
  Keys extends readonly PropertyKey[],
  Found extends PropertyKey = never,
> = Keys extends readonly [infer Key extends PropertyKey, ...infer Rest extends PropertyKey[]]
  ? GuaranteedKeysOfList<Rest, true extends IsDynamicColumn<Key> ? Found : Found | Key>
  : Keys extends readonly [...infer Rest extends PropertyKey[], infer Key extends PropertyKey]
    ? GuaranteedKeysOfList<Rest, true extends IsDynamicColumn<Key> ? Found : Found | Key>
    : Found

/** Tells whether the length of list `Keys` or the key of any of its elements can vary. */
type HasDynamicColumn<Keys extends readonly PropertyKey[]> = number extends Keys["length"]
  ? true
  : { [I in keyof Keys]: IsDynamicColumn<Keys[I]> }[number]

/** Keys of the columns that list `Keys` guarantees, in every list of a union of lists. */
// A union of functions infers its parameter as the intersection of theirs, so that a key guaranteed by one list alone is not among them; the intersection with the keys of the lists keeps the result a key of them for a generic `Keys`, and `never` for `never`.
export type GuaranteedColumnKeys<Keys extends readonly PropertyKey[]> = (
  Keys extends unknown
    ? (
        keys: true extends HasDynamicColumn<Keys> ? GuaranteedKeysOfList<Keys> : Keys[number],
      ) => void
    : never
) extends (keys: infer K) => void
  ? K & Keys[number]
  : never

/** Fields of `Row` selected by the keys of list `Keys`, with a required property for each key that the list guarantees and an optional one for each other key. */
export type PickSelectedColumns<Row, Keys extends readonly (keyof Row)[]> =
  // Distribute before inspecting positions so that a key guaranteed by one tuple stays local to that branch.
  Keys extends unknown
    ? true extends HasDynamicColumn<Keys>
      ? Pick<Row, GuaranteedKeysOfList<Keys>> & Partial<Pick<Row, Keys[number]>>
      : Pick<Row, Keys[number]>
    : never
