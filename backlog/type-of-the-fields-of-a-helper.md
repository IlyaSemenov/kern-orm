# Type of the fields of a helper

A type of the fields that a helper selects, such as of the records that a function returns from a query of the helper: `ResultOf` takes a query, while the fields are `E["fields"]` of `Helper<T, E, A>`, which `infer` reads from `typeof helper`.
Decide between `ResultOf` of a helper and a type of its own.
