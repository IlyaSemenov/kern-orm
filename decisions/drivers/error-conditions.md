# `QueryError` told by the conditions of PostgreSQL

`isQueryError(error, condition)` tells a `QueryError` by the name of its condition, which PostgreSQL gives each SQLSTATE in `errcodes.txt` and PL/pgSQL takes in `EXCEPTION WHEN`, and a check of the violated constraint compares `constraint` of the narrowed error:

```ts
// Chosen: one predicate of every condition, by its name
if (isQueryError(error, "unique_violation") && error.constraint === "form_name_key") {
  // ...
}

// Alternative: a predicate of the constraint too
if (isQueryError(error, "unique_violation", "form_name_key")) {
  // ...
}

// Alternative: a predicate of each condition
if (isUniqueViolation(error) && error.constraint === "form_name_key") {
  // ...
}

// Alternative: constants of the codes
if (error instanceof QueryError && error.code === SqlState.uniqueViolation) {
  // ...
}

// Alternative: a member of the class
if (error instanceof QueryError && error.is("unique_violation")) {
  // ...
}
```

It recognizes the error by `instanceof QueryError`, which tells the errors of every copy of `kern-db`, and reads only `code`, which a `QueryError` of every version has.
Its table of the 247 conditions of PostgreSQL 18 by their 251 codes adds 8 KB to a minified bundle, 2.7 KB gzipped, which a bundler drops from an application that does not call `isQueryError`.

The alternatives:

- A constraint argument of the predicate is shorter, but its narrowed type tells the constraint only for a literal argument.
  TypeScript then narrows the error to `never` where a check fails although the error may have another constraint: for a constraint that may be `undefined`, such as one that a wrapper forwards, after a check of the condition, and for the inner of two nested checks of different `string` constraints.
- A predicate of each condition, such as `isUniqueViolation(error)`, is shorter for the most common check and needs no table.
  Every other condition then needs a predicate of its own, or a comparison of `code` with its SQLSTATE, such as `"23503"`.
- Constants of the codes, such as `SqlState.uniqueViolation`, name the codes, but a check still takes `instanceof` and a comparison, and a check of a class compares the prefix of the code.
- A member of `QueryError`, such as `error.is("unique_violation")`, needs no import of its own, but a check still takes `instanceof` first, and an error of an earlier copy of `kern-db`, such as of a driver, lacks a member that a later version adds.
  Orchid ORM has such a member, `isUnique` of its `QueryError`, which tells only `23505`.
- A predicate that reads `code` of any object rather than of a `QueryError` also tells the errors of a client used without `kern-db`, but then also an error that ends the session, such as of `admin_shutdown`, which `kern-db` rejects with `ConnectionError`, and its narrowed type promises only `code`.
