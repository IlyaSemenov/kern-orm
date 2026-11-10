# Through and many-to-many relations

Relations through other relations, such as the answers of a form through its fields, and many-to-many relations through a join table, which queries select and filter by as other relations, as `chain` of Orchid ORM 1.78.47 queries the related records of related records ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/relation-queries.md#chain)).

- `EXISTS` of a chain correlates each relation with its own source; Orchid ORM joined the chained table to the outer one by the columns of the chained relation ([orchid-orm#851](https://github.com/romeerez/orchid-orm/issues/851)).
- Decide whether `$relations` declares a through relation, a query of a relation chains another relation, or both.
