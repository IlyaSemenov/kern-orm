import { expect, it } from "bun:test"

import {
  formActivity,
  getSubmissionReview,
  listFieldConditions,
  listUserActivity,
} from "../src/queries"
import { describePostgres, getSampleId } from "../testing/postgres"

describePostgres("relations in PostgreSQL", ({ testTransaction, tenantDb, saasDb, inTenant }) => {
  it("give the fields of a form with the field each is shown after and the fields shown after it, in a tenant and in the SaaS", async () => {
    const conditions = await testTransaction(async () => ({
      survey: await inTenant("tenant_1", () =>
        listFieldConditions(tenantDb, getSampleId("form:survey")),
      ),
      contact: await listFieldConditions(saasDb, getSampleId("form:contact")),
    }))

    expect(conditions).toStrictEqual({
      survey: [
        { label: "Name", shownAfter: undefined, dependents: [] },
        { label: "Has pets", shownAfter: undefined, dependents: ["Pet name", "Pet age"] },
        { label: "Pet name", shownAfter: "Has pets", dependents: [] },
        { label: "Pet age", shownAfter: "Has pets", dependents: [] },
      ],
      contact: [
        { label: "Name", shownAfter: undefined, dependents: [] },
        { label: "Email", shownAfter: undefined, dependents: ["Phone"] },
        { label: "Phone", shownAfter: "Email", dependents: [] },
      ],
    })
  })

  it("give the user and the reviewer of a submission, the answers to the fields of its form by their key with the comments on them, and the comments on the whole submission", async () => {
    const reviews = await testTransaction(() =>
      inTenant("tenant_1", async () => ({
        reviewed: await getSubmissionReview(tenantDb, getSampleId("submission:ada")),
        unreviewed: await getSubmissionReview(tenantDb, getSampleId("submission:alan")),
      })),
    )

    expect(reviews).toStrictEqual({
      reviewed: {
        user: "ada@example.com",
        reviewer: "grace@example.com",
        fields: [
          { label: "Name", answer: { value: "Ada", comments: [] } },
          { label: "Has pets", answer: { value: "yes", comments: [] } },
          { label: "Pet name", answer: { value: "Tom", comments: ["Is it Tom or Tim?", "Tom"] } },
          { label: "Pet age", answer: undefined },
        ],
        comments: ["Approved"],
      },
      unreviewed: {
        user: "alan@example.com",
        reviewer: undefined,
        fields: [
          { label: "Name", answer: { value: "Alan", comments: [] } },
          { label: "Has pets", answer: { value: "no", comments: [] } },
          { label: "Pet name", answer: undefined },
          { label: "Pet age", answer: undefined },
        ],
        comments: [],
      },
    })
  })

  it("count the submissions that each user filled in and reviewed, and give the answers of their comments, or none for a comment on a whole submission", async () => {
    const users = await testTransaction(() =>
      inTenant("tenant_1", () => listUserActivity(tenantDb)),
    )

    expect(users).toStrictEqual([
      {
        email: "ada@example.com",
        submitted: 1,
        reviewed: 1,
        comments: [
          { text: "Tom", answer: "Tom" },
          { text: "Thanks", answer: undefined },
        ],
      },
      { email: "alan@example.com", submitted: 1, reviewed: 0, comments: [] },
      {
        email: "grace@example.com",
        submitted: 1,
        reviewed: 1,
        comments: [
          { text: "Is it Tom or Tim?", answer: "Tom" },
          { text: "Approved", answer: undefined },
        ],
      },
    ])
  })

  it("page forms with two collections of records, one nested three levels deep", async () => {
    const pages = await testTransaction(() =>
      inTenant("tenant_1", async () => [
        await tenantDb.$execute(formActivity.limit(1)),
        await tenantDb.$execute(formActivity.limit(1).offset(1)),
        await tenantDb.$execute(formActivity.offset(2)),
      ]),
    )

    expect(pages).toStrictEqual([
      [
        {
          id: getSampleId("form:feedback"),
          name: "Feedback",
          fields: [{ label: "Comment", shownAfter: undefined }],
          submissionCount: 1,
          latestSubmissions: [
            {
              user: "grace@example.com",
              reviewer: "ada@example.com",
              answerCount: 1,
              comments: [{ author: "ada@example.com", text: "Thanks" }],
            },
          ],
        },
      ],
      [
        {
          id: getSampleId("form:survey"),
          name: "Survey",
          fields: [
            { label: "Name", shownAfter: undefined },
            { label: "Has pets", shownAfter: undefined },
            { label: "Pet name", shownAfter: "Has pets" },
            { label: "Pet age", shownAfter: "Has pets" },
          ],
          submissionCount: 2,
          latestSubmissions: [
            { user: "alan@example.com", reviewer: undefined, answerCount: 2, comments: [] },
            {
              user: "ada@example.com",
              reviewer: "grace@example.com",
              answerCount: 3,
              comments: [
                { author: "grace@example.com", text: "Is it Tom or Tim?" },
                { author: "ada@example.com", text: "Tom" },
                { author: "grace@example.com", text: "Approved" },
              ],
            },
          ],
        },
      ],
      [],
    ])
  })
})
