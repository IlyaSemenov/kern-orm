import type { OrchidTransactionSource } from "@kern-orm/orchid-interop"
import { createOrchidInterop, runInOrchidTransaction } from "@kern-orm/orchid-interop"
import type { Database } from "kern-db"
import { createBaseTable } from "orchid-orm"

const BaseTable = createBaseTable()
export class ItemTable extends BaseTable {
  readonly table = "kern_orchid_package_item"
  columns = this.setColumns(t => ({
    id: t.integer().primaryKey(),
  }))
}

export const connect = () =>
  createOrchidInterop(
    { connection: { databaseURL: process.env.DATABASE_URL! } },
    { item: ItemTable },
  )

// Type checking stays active for application code even when the declarations of Orchid ORM need skipLibCheck.
export async function query(interop: Awaited<ReturnType<typeof connect>>) {
  const row = await interop.orchid.item.find(1)
  const id: number = row.id
  // @ts-expect-error the existing Orchid table still rejects a string primary key
  interop.orchid.item.create({ id: "invalid" })
  return id
}

/** Tells whether Orchid reads a transaction-local setting that kern-db wrote through `runInOrchidTransaction`. */
export const joinOrchidTransaction = async (
  orchid: OrchidTransactionSource,
  database: Database,
) => {
  await runInOrchidTransaction(
    orchid,
    database,
    () => database.query`SELECT set_config('kern.package', 'joined', true)`,
  )
  const { rows } = await orchid
    .$getAdapter()
    .query<{ value: string }>("SELECT current_setting('kern.package') AS value")
  return rows[0]?.value === "joined"
}
