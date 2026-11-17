import { connect } from "./helper.ts"

const { database, orchid } = await connect()
try {
  await database.session(async () => {
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
    console.log(JSON.stringify({ rolledBack, committed }))
  })
} finally {
  await orchid.$close()
}
