import { expect, it } from "bun:test"

import { listFieldConditions } from "../src/queries"
import { copyForm } from "../src/templates"
import { describePostgres, getSampleId } from "../testing/postgres"

describePostgres(
  "templates in PostgreSQL",
  ({ database, testTransaction, tenantDb, saasDb, inTenant }) => {
    it("are copied into a tenant as unpublished forms with their fields and the conditions between them", async () => {
      const copy = await testTransaction(() =>
        inTenant("tenant_2", async () => {
          const formId = await copyForm(saasDb, tenantDb, getSampleId("form:contact"))
          return {
            form: await tenantDb.form.find(formId).select("name", "published"),
            conditions: await listFieldConditions(tenantDb, formId),
          }
        }),
      )

      expect(copy).toStrictEqual({
        form: { name: "Contact", published: false },
        conditions: [
          { label: "Name", shownAfter: undefined, dependents: [] },
          { label: "Email", shownAfter: undefined, dependents: ["Phone"] },
          { label: "Phone", shownAfter: "Email", dependents: [] },
        ],
      })
    })

    it("are copied without fields when they have none", async () => {
      const fieldCount = await testTransaction(() =>
        inTenant("tenant_2", async () => {
          const formId = await copyForm(saasDb, tenantDb, getSampleId("form:draft"))
          return await tenantDb.field.where({ formId }).count()
        }),
      )

      expect(fieldCount).toBe(0)
    })

    it("are not copied at all when a field fails to insert, keeping the transaction of the request usable", async () => {
      const names = await testTransaction(() =>
        inTenant("tenant_2", async () => {
          await database.script("ALTER TABLE tenant_2.form_field ADD CHECK (label <> 'Phone')")
          await expect(copyForm(saasDb, tenantDb, getSampleId("form:contact"))).rejects.toThrow(
            "form_field_label_check",
          )
          return await tenantDb.form.orderBy("name").pluck("name")
        }),
      )

      expect(names).toEqual(["Onboarding"])
    })
  },
)
