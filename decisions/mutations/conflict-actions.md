# Actions of a conflict as methods of `onConflict`

`onConflict` takes the columns of a key and returns a `ConflictTarget`, whose methods choose the action and return the mutation.

```ts
// Chosen
await db.membership.insert(member).onConflict("userId", "groupId").doNothing()

// A method of the mutation for each action
await db.membership.insert(member).onConflictDoNothing("userId", "groupId")
```

A method for each action saves the call of `onConflict` and the class of the conflict, but:

- An action that takes columns of its own, such as the columns that an update of the existing record takes from the inserted row, would take two lists of columns in one call, so that a key of several columns becomes an array, unlike the columns of `select` and `groupBy`: `onConflictMerge(["userId", "groupId"], ["position"])`.
- An action that takes the values of `update` would add a parameter of the key to each [overload of `update`](update-overloads.md), so that an error in the key makes every overload fail, and TypeScript reports the error of the last overload, about the values.
- Each action would infer and check the key in its own signature.

Orchid ORM has both forms: `onConflictDoNothing` beside `onConflict` with `merge`, `set`, and `ignore` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).
