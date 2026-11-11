// PostgreSQL of the acceptance tests at `DATABASE_URL`, such as from `.env.test.local`, with the SaaS and the sample tenants in their PostgreSQL schemas; the tests that need it are skipped without it.
import { afterAll, beforeAll, describe } from "bun:test"
import { createHash } from "node:crypto"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import type { Database, DbOf } from "kern-orm"
import { bindSchema, createDatabase } from "kern-orm"
import type { TestHelpers } from "kern-orm/testing"
import { createTestHelpers } from "kern-orm/testing"
import postgres from "postgres"
import { defineDependency, provide, withOverrides } from "ripple-di"

import type { formsSchema } from "../src/schemas"
import { saasSchema, tenantSchema } from "../src/schemas"

const { DATABASE_URL } = process.env

/** PostgreSQL schema of the tenant of the current request, which the tenant `Db` reads on every query. */
const useTenantSchemaName = defineDependency<string>()

/** Database of a block of tests with the `Db` of the tenants and of the SaaS bound to it. */
export interface FormsDatabaseContext {
  /** Database of the block, closed after it. */
  readonly database: Database
  /** `Db` of the tenant that `inTenant` runs its callback for. */
  readonly tenantDb: DbOf<typeof tenantSchema>
  /** `Db` of the SaaS in PostgreSQL schema `saas` of `describePostgres` or `pool_saas` of `describePooledPostgres`. */
  readonly saasDb: DbOf<typeof saasSchema>
  /** Runs `callback` as a request of the tenant in PostgreSQL schema `schemaName`. */
  inTenant<T>(schemaName: string, callback: () => Promise<T>): Promise<T>
}

/** Database of a `describePostgres` block, created with `test: true`, with its test helpers. */
export interface FormsTestContext extends FormsDatabaseContext, TestHelpers {}

/** Database of a `describePooledPostgres` block, created without `test: true`. */
export interface FormsPooledContext extends FormsDatabaseContext {
  /** Creates the SaaS in PostgreSQL schema `pool_saas` and the tenants in `pool_tenant_1` and `pool_tenant_2` with the records of `getSampleId`, as `describePostgres` does. */
  createSampleData(): Promise<void>
  /** Drops the PostgreSQL schemas of `createSampleData`. */
  dropSampleData(): Promise<void>
}

/**
 * Declares a `describe` block of tests that run in PostgreSQL, skipped when `DATABASE_URL` is not set.
 *
 * A fixture of the block creates the SaaS in PostgreSQL schema `saas` and the tenants in `tenant_1` and `tenant_2` with the records of `getSampleId`.
 * `body` registers the tests, which use the database of the block through `context`.
 */
export function describePostgres(name: string, body: (context: FormsTestContext) => void): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    const context = connect({ test: true, prefix: "" })
    const helpers = createTestHelpers(context.database, { before: beforeAll, after: afterAll })
    helpers.useTestFixture(() => createSampleData(context, ""))
    body({ ...context, ...helpers })
  })
}

/**
 * Declares a `describe` block of tests that run in PostgreSQL on a pooled database, such as tests of transactions, skipped when `DATABASE_URL` is not set.
 *
 * Its database runs every statement outside a transaction on the pool, as in an application, unlike the database of `describePostgres`, so that the tests tell the connections of statements apart.
 * The data of the tests exists only in their transactions: a test creates it with `createSampleData` in a transaction, which rolls back or drops it with `dropSampleData` before it commits.
 * Its PostgreSQL schemas differ from those of `describePostgres`, so that creating them never waits for an open fixture.
 */
export function describePooledPostgres(
  name: string,
  body: (context: FormsPooledContext) => void,
): void {
  describe.skipIf(!DATABASE_URL)(name, () => {
    const context = connect({ test: false, prefix: "pool_" })
    body({
      ...context,
      createSampleData: () => createSampleData(context, "pool_"),
      dropSampleData: () =>
        // Keeps PostgreSQL from sending a notice of each table that the drop cascades to.
        context.database.script(`
          SET LOCAL client_min_messages = warning;
          DROP SCHEMA pool_saas, pool_tenant_1, pool_tenant_2 CASCADE;
        `),
    })
  })
}

/**
 * Creates a database at `DATABASE_URL`, closed after the enclosing block, and binds the tenant `Db` and the SaaS `Db` to it.
 *
 * The SaaS `Db` uses PostgreSQL schema `saas` after `prefix`, as the sample data of `createSampleData`.
 */
function connect(options: { test: boolean; prefix: string }): FormsDatabaseContext {
  const database = createDatabase({
    driver: postgresJsDriver(postgres(DATABASE_URL!)),
    test: options.test,
  })
  afterAll(() => database.close())
  return {
    database,
    tenantDb: bindSchema(tenantSchema, database, { schemaName: () => useTenantSchemaName() }),
    saasDb: bindSchema(saasSchema, database, { schemaName: `${options.prefix}saas` }),
    inTenant: (schemaName, callback) =>
      withOverrides(provide(useTenantSchemaName, schemaName), callback),
  }
}

/** Returns the ID of the sample record of `key`, such as `form:survey`. */
export function getSampleId(key: string): string {
  const hex = createHash("md5").update(key).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Script that creates the tables of the forms of the SaaS or of a tenant in PostgreSQL schema `schemaName`, with the indexes of their relations and of their order. */
export function createFormTables(schemaName: string): string {
  return `
    CREATE SCHEMA ${schemaName};
    CREATE TABLE ${schemaName}.form (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      published boolean NOT NULL
    );
    CREATE INDEX ON ${schemaName}.form (name, id);
    CREATE TABLE ${schemaName}.form_field (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      form_id uuid NOT NULL REFERENCES ${schemaName}.form,
      position integer NOT NULL,
      label text NOT NULL,
      condition_field_id uuid REFERENCES ${schemaName}.form_field,
      UNIQUE (form_id, position)
    );
    CREATE INDEX ON ${schemaName}.form_field (condition_field_id);
  `
}

/** Script that creates the tables of a tenant in PostgreSQL schema `schemaName`, with the indexes of their relations and of their order. */
export function createTenantTables(schemaName: string): string {
  return `
    ${createFormTables(schemaName)}
    CREATE TABLE ${schemaName}."user" (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
    CREATE TABLE ${schemaName}.form_submission (
      id uuid PRIMARY KEY,
      form_id uuid NOT NULL REFERENCES ${schemaName}.form,
      user_id uuid NOT NULL REFERENCES ${schemaName}."user",
      reviewer_id uuid REFERENCES ${schemaName}."user",
      created_at timestamptz NOT NULL
    );
    CREATE INDEX ON ${schemaName}.form_submission (form_id, created_at);
    CREATE INDEX ON ${schemaName}.form_submission (user_id);
    CREATE INDEX ON ${schemaName}.form_submission (reviewer_id);
    CREATE TABLE ${schemaName}.form_answer (
      id uuid PRIMARY KEY,
      submission_id uuid NOT NULL REFERENCES ${schemaName}.form_submission,
      field_id uuid NOT NULL REFERENCES ${schemaName}.form_field,
      value text NOT NULL,
      UNIQUE (submission_id, field_id)
    );
    CREATE TABLE ${schemaName}.form_comment (
      id uuid PRIMARY KEY,
      submission_id uuid NOT NULL REFERENCES ${schemaName}.form_submission,
      field_id uuid,
      author_id uuid NOT NULL REFERENCES ${schemaName}."user",
      text text NOT NULL,
      created_at timestamptz NOT NULL,
      FOREIGN KEY (submission_id, field_id) REFERENCES ${schemaName}.form_answer (submission_id, field_id)
    );
    CREATE INDEX ON ${schemaName}.form_comment (submission_id, field_id);
    CREATE INDEX ON ${schemaName}.form_comment (author_id);
  `
}

/** Inserts form `key` of `db` with its fields, each shown after the field of the key it names. */
async function insertForm(
  db: DbOf<typeof formsSchema>,
  key: string,
  name: string,
  published: boolean,
  fields: readonly (readonly [key: string, label: string, condition?: string])[],
): Promise<void> {
  const formId = getSampleId(`form:${key}`)
  await db.form.insert({ id: formId, name, published })
  if (fields.length > 0) {
    await db.field.insertMany(
      fields.map(([field, label, condition], index) => ({
        id: getSampleId(`field:${key}:${field}`),
        formId,
        position: index + 1,
        label,
        conditionFieldId: condition === undefined ? null : getSampleId(`field:${key}:${condition}`),
      })),
    )
  }
}

/**
 * Creates the tables and records of the sample data, in PostgreSQL schemas whose names start with `prefix`: the SaaS with form templates, and two tenants.
 *
 * - `saas`: the published template `contact`, whose phone field is shown after the email field, and the unpublished `draft`.
 * - `tenant_1`: the published forms `survey`, whose pet fields are shown after `pets`, and `feedback`, the unpublished `archive`, the users `ada`, `alan`, and `grace`, and the submissions of `ada` and `alan` of `survey` and of `grace` of `feedback`, with answers and comments.
 * - `tenant_2`: the published form `onboarding`.
 */
async function createSampleData(context: FormsDatabaseContext, prefix: string): Promise<void> {
  const { saasDb, tenantDb, inTenant } = context
  await context.database.script(
    createFormTables(`${prefix}saas`) +
      createTenantTables(`${prefix}tenant_1`) +
      createTenantTables(`${prefix}tenant_2`),
  )
  await insertForm(saasDb, "contact", "Contact", true, [
    ["name", "Name"],
    ["email", "Email"],
    ["phone", "Phone", "email"],
  ])
  await insertForm(saasDb, "draft", "Draft", false, [])
  await inTenant(`${prefix}tenant_1`, async () => {
    await insertForm(tenantDb, "survey", "Survey", true, [
      ["name", "Name"],
      ["pets", "Has pets"],
      ["pet-name", "Pet name", "pets"],
      ["pet-age", "Pet age", "pets"],
    ])
    await insertForm(tenantDb, "feedback", "Feedback", true, [["comment", "Comment"]])
    await insertForm(tenantDb, "archive", "Archive", false, [])
    await tenantDb.user.insertMany(
      ["ada", "alan", "grace"].map(user => ({
        id: getSampleId(`user:${user}`),
        email: `${user}@example.com`,
      })),
    )
    await tenantDb.submission.insertMany([
      {
        id: getSampleId("submission:ada"),
        formId: getSampleId("form:survey"),
        userId: getSampleId("user:ada"),
        reviewerId: getSampleId("user:grace"),
        createdAt: "2026-01-01T10:00:00Z",
      },
      {
        id: getSampleId("submission:alan"),
        formId: getSampleId("form:survey"),
        userId: getSampleId("user:alan"),
        createdAt: "2026-01-02T10:00:00Z",
      },
      {
        id: getSampleId("submission:grace"),
        formId: getSampleId("form:feedback"),
        userId: getSampleId("user:grace"),
        reviewerId: getSampleId("user:ada"),
        createdAt: "2026-01-03T10:00:00Z",
      },
    ])
    await tenantDb.answer.insertMany(
      (
        [
          ["ada", "survey:name", "Ada"],
          ["ada", "survey:pets", "yes"],
          ["ada", "survey:pet-name", "Tom"],
          ["alan", "survey:name", "Alan"],
          ["alan", "survey:pets", "no"],
          ["grace", "feedback:comment", "Great"],
        ] as const
      ).map(([submission, field, value]) => ({
        id: getSampleId(`answer:${submission}:${field}`),
        submissionId: getSampleId(`submission:${submission}`),
        fieldId: getSampleId(`field:${field}`),
        value,
      })),
    )
    await tenantDb.comment.insertMany(
      (
        [
          ["1", "ada", "survey:pet-name", "grace", "Is it Tom or Tim?", "2026-01-01T11:00:00Z"],
          ["2", "ada", "survey:pet-name", "ada", "Tom", "2026-01-01T12:00:00Z"],
          ["3", "ada", undefined, "grace", "Approved", "2026-01-01T13:00:00Z"],
          ["4", "grace", undefined, "ada", "Thanks", "2026-01-03T11:00:00Z"],
        ] as const
      ).map(([key, submission, field, author, text, createdAt]) => ({
        id: getSampleId(`comment:${key}`),
        submissionId: getSampleId(`submission:${submission}`),
        fieldId: field === undefined ? null : getSampleId(`field:${field}`),
        authorId: getSampleId(`user:${author}`),
        text,
        createdAt,
      })),
    )
  })
  await inTenant(`${prefix}tenant_2`, () =>
    insertForm(tenantDb, "onboarding", "Onboarding", true, [["team", "Team"]]),
  )
}
