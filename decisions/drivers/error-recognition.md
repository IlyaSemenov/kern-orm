# Errors of drivers recognized by `instanceof`

`QueryError`, `ConnectionError`, and `TransactionConnectionError` recognize the errors of another copy of `kern-orm` in `instanceof`: the constructor sets a brand of `Symbol.for`, a property that is not enumerable, and `Symbol.hasInstance` of the class checks it, so that an error that a driver throws with its own copy of `kern-orm` is an instance of the class of the copy of the application.

```ts
// Chosen: the classes recognize the errors of every copy
try {
  await db.form.insert({ name: "Survey" })
} catch (error) {
  if (error instanceof QueryError && error.code === "23505") {
    // ...
  }
}

// Alternative: predicates that check the brand
if (hasQueryErrorBrand(error) && error.code === "23505") {
  // ...
}
```

`Symbol.hasInstance` checks the brand only when it is called on the class itself; a subclass checks the prototype chain, so that `instanceof` of a subclass, such as of an application that subclasses `QueryError` for its own errors, is not true for every `QueryError`.
Its type is a predicate of the type of the class that it is called on, so `instanceof` of a subclass narrows to the subclass, and the declarations of the classes do not name the brand.

The alternatives:

- Predicates, such as `hasQueryErrorBrand(error)`, say what they check, and `instanceof` stays the ordinary check of the prototype chain.
  An application then has two checks of one class, and only the predicate is correct across copies, while `instanceof`, which tests, `assert.rejects(promise, QueryError)`, and `expect(promise).rejects.toThrow(QueryError)` use, passes with one copy and fails with two.
- Classes without a brand fail `instanceof` whenever the application and a driver resolve different copies of `kern-orm`, such as when the range of the driver does not accept the version of the application.

An error of another copy recognized by the brand still has the prototype of its own class, so a member that a later version of `kern-orm` adds to the class may be missing from it.
