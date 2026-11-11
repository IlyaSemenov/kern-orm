// Types of kern-db of every entry point that creates or takes them, also of `kern-db`, which npm installs as the dependency of `kern-orm`; prints whether each entry point recognizes the types of the others, without PostgreSQL.
import { createDatabase, defineType as defineDbType, isType as isDbType, param } from "kern-db"
import * as dbTypes from "kern-db/types"
import { bindSchema, defineSchema, defineTable, defineType, equalityOperators } from "kern-orm"
import { defineType as defineOrmDbType, isType as isOrmDbType } from "kern-orm/db"
import * as ormDbTypes from "kern-orm/db/types"
import * as t from "kern-orm/types"

import { createRecordingDriver } from "./recording-driver.ts"

const formId = "6f1c1f5e-4e8f-4c2a-9a55-9f5a3c4b2d10"
const { driver, statements } = createRecordingDriver(text =>
  text.includes("count")
    ? { columns: ["id", "count"], rows: [[formId, "2"]] }
    : { columns: ["id"], rows: [[formId]] },
)
// A database of kern-db, which the ORM binds a schema to.
const database = createDatabase({ driver })
const form = defineTable("form", {
  id: defineType(dbTypes.uuid).withOperators(equalityOperators).primaryKey(),
  path: defineType(defineDbType({ sqlType: "ltree" })),
})
const db = bindSchema(defineSchema({ form }), database)

console.log(
  JSON.stringify({
    // The entry points of the built-in types of kern-db export the same types.
    sameBuiltInTypes: Object.keys(dbTypes).every(
      key => dbTypes[key as keyof typeof dbTypes] === ormDbTypes[key as keyof typeof dbTypes],
    ),
    // A type of the ORM is a type of kern-db, and the types of kern-db are types of `kern-orm/db`.
    ormTypeIsDbType: isDbType(t.uuid),
    ormDbTypeIsDbType: isDbType(defineOrmDbType({ sqlType: "ltree" })),
    dbTypeIsOrmDbType: isOrmDbType(dbTypes.uuid),
    // A query of SQL text of kern-db decodes with the types of the ORM, and `$query` of a `Db` with the types of kern-db.
    record: await database.query`SELECT id, count FROM form`
      .select({
        id: t.uuid,
        count: dbTypes.integer,
      })
      .take(),
    value: await database.query`SELECT id FROM form`.get(t.uuid),
    ormRecord: await db.$query`SELECT id, count FROM form`
      .select({
        id: dbTypes.uuid,
        count: ormDbTypes.integer,
      })
      .take(),
    // `param` of kern-db encodes with a type of the ORM.
    parameter: database.query`SELECT ${param(t.integer, 7)}`.toSQL(),
    // A query of the ORM filters a column of a type defined from a type of kern-db.
    ormQuery: db.form.where({ id: formId }).select("path").toSQL(),
    statements,
  }),
)
await database.close()
