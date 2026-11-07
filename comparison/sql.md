# SQL generation

## The outer source of a correlated subquery

A correlated subquery refers to its outer source by identity, so the alias that it refers to always exists.

- Orchid ORM, fails: `queryRelated` of a `through` relation referred to a missing table alias ([orchid-orm#855](https://github.com/romeerez/orchid-orm/issues/855)).
