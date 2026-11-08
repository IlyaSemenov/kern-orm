# Actions of a conflict as methods of `onConflict`

`onConflict` takes the columns of a key and returns a `ConflictTarget`, whose methods choose the action and return the mutation.

```ts
// Chosen
await db.membership.insert(member).onConflict("userId", "groupId").doNothing()

// A method of the mutation for each action
await db.membership.insert(member).onConflictDoNothing("userId", "groupId")
```

A method for each action saves the call of `onConflict` and the class of the conflict, but:

- `merge`, which takes the columns that it sets from the inserted row, would take two lists of columns in one call, so that a key of several columns becomes an array, unlike the columns of `select` and `groupBy`: `onConflictMerge(["userId", "groupId"], ["position"])`.
- `update`, which takes the values of `update` of a query, would add a parameter of the key to each of its [overloads](update-overloads.md), so that an error in the key makes every overload fail, and TypeScript reports the error of the last overload, about the values.
- Each action would infer and check the key in its own signature.

Orchid ORM has both forms: `onConflictDoNothing` beside `onConflict` with `merge`, `set`, and `ignore` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).
