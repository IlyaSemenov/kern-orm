export default {
  up: "CREATE TABLE form (id integer PRIMARY KEY, name text NOT NULL)",
  down: "DROP TABLE form",
}
