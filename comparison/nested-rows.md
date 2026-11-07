# Nested rows

## A missing record, `NULL`, and an empty array

A nested value tells apart a missing row, `NULL`, and an empty array, at any depth and through a helper.

- Orchid ORM, fails: a nested array value inside `select` could not tell `null`, an empty array, and a missing record apart, nor a missing record and `NULL` of a value nested three levels deep ([orchid-orm#830](https://github.com/romeerez/orchid-orm/issues/830)).

## A related value selected twice under one key

A related value that a later selection replaces under its key decodes once.

- Orchid ORM, fails: selecting a relation value twice under one key unwrapped it twice ([orchid-orm#792](https://github.com/romeerez/orchid-orm/issues/792)).
