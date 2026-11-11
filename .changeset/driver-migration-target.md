---
"kern-migrations": minor
---

Accept a driver of kern-db as the target of `migrate`, `rollback`, `redo`, `getMigrationStatus`, `runMigrationCli`, and `verifyMigrations`, without joining the transactions of the databases of the application or closing the driver.
