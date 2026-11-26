# Column changes of `alterTable`

Consider `changeColumns` of `alterTable`, which would change columns as `changeColumn` does, such as `{ position: [from, to] }` of its states, when a migration needs to change columns together with other changes of the table in one `ALTER TABLE`, such as to rewrite the table once.

Open questions:

- In what order should `changeColumns` write the actions of different columns, since `changeColumn` drops a default before it changes the type and sets it after?
- Where should those actions go relative to the dropped and added columns and constraints, such as a change of the type of a column that an added constraint checks?
