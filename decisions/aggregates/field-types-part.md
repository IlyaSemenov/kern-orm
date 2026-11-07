# The `fieldTypes` part of the state

The `fieldTypes` part holds the type of the value of each selected field, which the references of `having` read, and `SelectedFieldTypes` defers its merge until the types are read.

```ts
db.submission
  .select(submission => ({
    formId: submission.formId,
    lastSubmitted: max(submission.createdAt),
  }))
  .groupBy("formId")
  // `timestamptz`: the operators of ordering, which take a `Date` too
  .having((submission, selected) => selected.lastSubmitted.gt(weekAgo))
```

- Operators chosen by the decoded values of `result` would give some types operators that they lack and others none of theirs, since `timestamptz`, `date`, and `numeric` decode to strings, and the values that a type encodes, such as a `Date` of `timestamptz`, would be lost.
  The `string | null` of `lastSubmitted` would give it `like` and reject `weekAgo`.
- Merged eagerly by `MergeSelection`, as the result is, the part added about 14% to applying a helper and 5% to the first query of a deep relation graph; deferred, it adds about 2.5–4% and 0.6%, and up to 1.6% to a few other queries.

  ```ts
  // The state of `select` of a callback that returns `Sel`
  result: MergeSelection<S["result"], SelectionResult<Sel>>
  // Deferred: `having` reads `types` of the interface, which merges them
  fieldTypes: SelectedFieldTypes<S["fieldTypes"], SelectionFieldTypes<Sel>>
  // Eager, as the result
  fieldTypes: MergeSelection<S["fieldTypes"], SelectionFieldTypes<Sel>>
  ```
