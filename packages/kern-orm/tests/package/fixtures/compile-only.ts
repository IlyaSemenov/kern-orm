// Compiles a query without executing it, using one built-in type.
import { defineTable, from } from "kern-orm"
import { text } from "kern-orm/types"

const form = defineTable("form", {
  name: text,
})

const { text: sqlText, parameters } = from(form).where({ name: "Survey" }).select("name").toSQL()
console.log(JSON.stringify({ text: sqlText, parameters }))
