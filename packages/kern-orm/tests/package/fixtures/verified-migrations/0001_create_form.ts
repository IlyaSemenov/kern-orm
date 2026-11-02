import { defineMigration } from "@kern-orm/migrations"

export default defineMigration({
  up: "CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL)",
  down: "DROP TABLE form",
})
