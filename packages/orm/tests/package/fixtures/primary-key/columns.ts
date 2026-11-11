// Primary keys of types and columns, nullable or not, whose type errors name the reason.
import * as t from "kern-orm/types"

t.uuid.primaryKey()
t.uuid.columnName("form_id").primaryKey()
t.uuid.nullable().primaryKey()
t.uuid.nullable().columnName("form_id").primaryKey()
