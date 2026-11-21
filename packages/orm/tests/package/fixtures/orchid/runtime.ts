import { orchidORM } from "orchid-orm/postgres-js"

import { connect, joinOrchidTransaction } from "./helper.ts"

const { database, orchid } = await connect()
const native = orchidORM({ databaseURL: process.env.DATABASE_URL! }, {})
try {
  const shared = await database.session(async () => {
    await database.script("CREATE TEMP TABLE kern_orchid_package_item (id integer PRIMARY KEY)")
    try {
      await database.transaction(async () => {
        await orchid.item.create({ id: 1 })
        throw new Error("rollback")
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error
    }
    const rolledBack = (await orchid.item.count()) === 0
    await orchid.$transaction(async () => {
      await database.query`INSERT INTO kern_orchid_package_item VALUES (2)`
      await orchid.item.create({ id: 3 })
    })
    const committed = (await orchid.item.count()) === 2
    await database.script("DROP TABLE kern_orchid_package_item")
    return { rolledBack, committed }
  })
  // The external transaction of a native instance of Orchid runs outside the session, which has a connection of its own.
  const joined = await native.$transaction(() => joinOrchidTransaction(native, database))
  console.log(JSON.stringify({ ...shared, joined }))
} finally {
  await native.$close()
  await orchid.$close()
}
