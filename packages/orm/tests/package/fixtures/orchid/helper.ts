import { createOrchidInterop } from "@kern-orm/orchid-interop"
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
