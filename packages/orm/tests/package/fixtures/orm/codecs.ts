// Codecs of every entry point that creates or takes them, also of `kern-db`, which npm installs as the dependency of `kern-orm`; prints whether each entry point recognizes the codecs of the others, without PostgreSQL.
import { createDatabase, defineCodec, isCodec, param } from "kern-db"
import * as dbCodecs from "kern-db/types"
import { bindSchema, defineSchema, defineTable, defineType, equalityOperators } from "kern-orm"
import { defineCodec as defineOrmCodec, isCodec as isOrmCodec } from "kern-orm/db"
import * as ormDbCodecs from "kern-orm/db/types"
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
  id: defineType(dbCodecs.uuid).withOperators(equalityOperators).primaryKey(),
  path: defineType(defineCodec({ sqlType: "ltree" })),
})
const db = bindSchema(defineSchema({ form }), database)

console.log(
  JSON.stringify({
    // The entry points of the codecs of the built-in types export the same codecs.
    sameBuiltInCodecs: Object.keys(dbCodecs).every(
      key => dbCodecs[key as keyof typeof dbCodecs] === ormDbCodecs[key as keyof typeof dbCodecs],
    ),
    // A type of the ORM is a codec of kern-db, and the codecs of kern-db are codecs of `kern-orm/db`.
    typeIsCodec: isCodec(t.uuid),
    codecOfOrmIsCodec: isCodec(defineOrmCodec({ sqlType: "ltree" })),
    codecIsCodecOfOrm: isOrmCodec(dbCodecs.uuid),
    // A query of SQL text of kern-db decodes with the types of the ORM, and `$query` of a `Db` with the codecs of kern-db.
    record: await database.query`SELECT id, count FROM form`
      .select({
        id: t.uuid,
        count: dbCodecs.integer,
      })
      .take(),
    value: await database.query`SELECT id FROM form`.get(t.uuid),
    ormRecord: await db.$query`SELECT id, count FROM form`
      .select({
        id: dbCodecs.uuid,
        count: ormDbCodecs.integer,
      })
      .take(),
    // `param` of kern-db encodes with a type of the ORM.
    parameter: database.query`SELECT ${param(t.integer, 7)}`.toSQL(),
    // A query of the ORM filters a column of a type defined from a codec of kern-db.
    ormQuery: db.form.where({ id: formId }).select("path").toSQL(),
    statements,
  }),
)
await database.close()
