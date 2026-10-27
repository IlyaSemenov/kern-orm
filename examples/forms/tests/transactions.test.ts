import { expect, it } from "bun:test"

import { provide, withOverrides } from "ripple-di"

import {
  getForm,
  getPublishedFormNames,
  getSubmissionReview,
  listFormSummaries,
  useFormsDb,
} from "../src/queries"
import { describePooledPostgres, getSampleId } from "../testing/postgres"

describePooledPostgres(
  "transactions",
  ({ tenantDb, saasDb, inTenant, createSampleData, dropSampleData }) => {
    // The sample data exists only in the transaction that creates it, so a statement on another connection does not find its tables.

    it("started through the Db of the tenant of a request run shared code of the tenant and of the SaaS on their connection", async () => {
      const result = await inTenant("pool_tenant_1", () =>
        tenantDb.$transaction(async () => {
          await createSampleData()
          const result = {
            review: await getSubmissionReview(tenantDb, getSampleId("submission:ada")),
            template: await getForm(saasDb, getSampleId("form:contact")),
            // A transaction of the SaaS Db nested in it is a savepoint on its connection.
            templateNames: await saasDb.$transaction(() =>
              withOverrides(provide(useFormsDb, saasDb), getPublishedFormNames),
            ),
          }
          await dropSampleData()
          return result
        }),
      )

      expect(result).toMatchObject({
        review: { user: "ada@example.com", reviewer: "grace@example.com", comments: ["Approved"] },
        template: {
          name: "Contact",
          fields: [{ label: "Name" }, { label: "Email" }, { label: "Phone" }],
        },
        templateNames: ["Contact"],
      })
    })

    it("started through the SaaS Db run shared code of each tenant on their connection", async () => {
      const summaries = await saasDb.$transaction(async () => {
        await createSampleData()
        const summaries = []
        for (const schemaName of ["pool_tenant_1", "pool_tenant_2"]) {
          summaries.push(await inTenant(schemaName, () => listFormSummaries(tenantDb)))
        }
        await dropSampleData()
        return summaries
      })

      expect(summaries).toMatchObject([
        [
          { name: "Feedback", labels: "Comment" },
          { name: "Survey", labels: "Name, Has pets, Pet name, Pet age" },
        ],
        [{ name: "Onboarding", labels: "Team" }],
      ])
    })

    it("leave shared code of a concurrent request on the pool", async () => {
      const created = Promise.withResolvers<void>()
      const checked = Promise.withResolvers<void>()
      const rollback = new Error("rollback")
      const transaction = saasDb.$transaction(async () => {
        await createSampleData()
        created.resolve()
        await checked.promise
        throw rollback
      })

      try {
        await Promise.race([created.promise, transaction])
        await expect(
          withOverrides(provide(useFormsDb, saasDb), getPublishedFormNames),
        ).rejects.toThrow('relation "pool_saas.form" does not exist')
      } finally {
        checked.resolve()
        await expect(transaction).rejects.toBe(rollback)
      }
    })
  },
)
