# `expr` of a query of one value

The operators of the value of a query are those of the expression that `expr` gives, a method that takes the query from `this`.
A condition that a form has more than 3 fields reads in each design:

```ts
db.form.where(form => form.fields.count().expr().gt(3)) // chosen
db.form.where(form => form.fields.count().ops.gt(3)) // a getter
db.form.where(form => form.fields.count().expr(count => count.gt(3))) // a callback
db.form.where(form => form.fields.count().gt(3)) // methods of the query
db.form.where(form => gt(form.fields.count(), 3)) // functions of the operators
```

- A getter would type its result by the state of the class and break the covariance of a query.
- A callback adds nesting without a gain.
- The operators are not methods of the query, as in Orchid ORM 1.78.37, such as `q.sum("points").gt(0)`: a custom operator could take the name of a method of a query, so `withOperators` would reject those names, every new method of a query would break the custom types that have an operator of its name, and the query would need a prototype for each type of its value.
- The operators have no functions of their own: they belong to types, including custom ones, which would each need a function too.
