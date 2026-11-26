# Column changes of `alterTable`

Consider a `changeColumns` change of `alterTable` that takes the same record as the `changeColumns` helper, such as `{ position: [from, to] }` of its states, for when a migration needs to change columns together with other changes of the table in one `ALTER TABLE`, such as to rewrite the table once.

Open question: where should those actions go relative to the dropped and added columns and constraints, such as a change of the type of a column that an added constraint checks?
