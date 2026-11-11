# Moving from rake-db

Moving a project from rake-db to `kern-migrations`:

- Decide whether the migrator imports the applied versions of a rake-db table, of `version` and `name`, once, or projects convert them.
- Decide how a history whose earlier migrations a baseline of the schema replaces marks the baseline applied on existing targets.
