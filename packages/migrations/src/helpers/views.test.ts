import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { describePostgres } from "../../testing/postgres"
import { defineMigrations } from "../history"
import { verifyMigrations } from "../verification/verify"

import { invertStep } from "./step"
import { createTable } from "./tables"
import { applyStep } from "./testing"
import { createView, dropView, replaceView } from "./views"

const createForm = "CREATE TABLE form (id integer, name text, published boolean)"

const checkPublicForm = `SELECT pg_catalog.format('%I.%I', pg_catalog.current_schema(), 'public_form')::pg_catalog.regclass`

describe("createView", () => {
  it("creates a view of a quoted name of a query, and drops it", () => {
    expect(createView("public_form", "SELECT id FROM form WHERE published")).toEqual({
      up: 'CREATE VIEW "public_form" AS SELECT id FROM form WHERE published',
      down: 'DROP VIEW "public_form"',
    })
  })

  it("creates a view with the options that it gives", () => {
    expect(
      createView("public_form", "SELECT id FROM form WHERE published", {
        checkOption: "local",
        securityBarrier: true,
        securityInvoker: false,
      }).up,
    ).toBe(
      `CREATE VIEW "public_form" WITH (check_option = 'local', security_barrier = true, security_invoker = false) AS SELECT id FROM form WHERE published`,
    )
  })

  it("throws for an invalid value of an option", () => {
    expect(
      getThrownError(() =>
        createView("public_form", "SELECT id FROM form", { checkOption: "none" as never }),
      ),
    ).toEqual(
      new Error("Invalid options of view public_form: checkOption must be local or cascaded"),
    )
    expect(
      getThrownError(() =>
        createView("public_form", "SELECT id FROM form", { securityInvoker: "true" as never }),
      ),
    ).toEqual(new Error("Invalid options of view public_form: securityInvoker must be a Boolean"))
  })
})

describe("dropView", () => {
  it("drops a view, and creates it again as createView does", () => {
    expect(
      dropView("public_form", "SELECT id FROM form WHERE published", { securityInvoker: true }),
    ).toEqual({
      up: 'DROP VIEW "public_form"',
      down: 'CREATE VIEW "public_form" WITH (security_invoker = true) AS SELECT id FROM form WHERE published',
    })
  })
})

describe("replaceView", () => {
  it("checks that the target schema has the view, replaces its query, and restores the previous query", () => {
    expect(
      replaceView("public_form", "SELECT id FROM form", "SELECT id FROM form WHERE published"),
    ).toEqual({
      up: `${checkPublicForm}\n;\nCREATE OR REPLACE VIEW "public_form" AS SELECT id FROM form WHERE published`,
      down: `${checkPublicForm}\n;\nCREATE OR REPLACE VIEW "public_form" AS SELECT id FROM form`,
    })
  })

  it("with rollback recreate, drops the view and creates it again on rollback", () => {
    expect(
      replaceView("public_form", "SELECT id FROM form", "SELECT id, name FROM form", {
        rollback: "recreate",
      }).down,
    ).toBe('DROP VIEW "public_form"\n;\nCREATE VIEW "public_form" AS SELECT id FROM form')
  })

  it("sets the options of the view in both directions", () => {
    const step = replaceView("public_form", "SELECT id FROM form", "SELECT id, name FROM form", {
      securityInvoker: true,
      rollback: "recreate",
    })

    expect(step.up).toEndWith(
      'CREATE OR REPLACE VIEW "public_form" WITH (security_invoker = true) AS SELECT id, name FROM form',
    )
    expect(step.down).toEndWith(
      'CREATE VIEW "public_form" WITH (security_invoker = true) AS SELECT id FROM form',
    )
  })

  it("throws for an unknown rollback", () => {
    expect(
      getThrownError(() =>
        replaceView("public_form", "SELECT id FROM form", "SELECT id FROM form", {
          rollback: "drop" as never,
        }),
      ),
    ).toEqual(new Error("Cannot replace view public_form: unknown rollback drop"))
  })
})

describePostgres("view helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("createView creates a view with its options, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        createView("public_form", "SELECT id FROM form WHERE published", {
          securityInvoker: true,
        }),
        createForm,
      ),
    )

    expect(result.up).toEqual([
      "column form.id integer",
      "column form.name text",
      "column form.published boolean",
      "column public_form.id integer",
      "table form",
      "view public_form SELECT id\n   FROM form\n  WHERE published; WITH (security_invoker=true)",
    ])
    expect(result.down).toEqual(result.before)
  })

  it("dropView drops a view, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropView("public_form", "SELECT id FROM form WHERE published"),
        `${createForm}; CREATE VIEW public_form AS SELECT id FROM form WHERE published`,
      ),
    )

    expect(result.up).not.toEqual(result.before)
    expect(result.down).toEqual(result.before)
  })

  it("replaceView replaces the query of a view keeping its grants and its options, and its rollback restores the query keeping them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        replaceView(
          "public_form",
          "SELECT id, name FROM form",
          "SELECT id, name FROM form WHERE published",
          { securityInvoker: true },
        ),
        `${createForm}; CREATE VIEW public_form WITH (security_invoker = true) AS SELECT id, name FROM form; GRANT SELECT ON public_form TO PUBLIC`,
      ),
    )

    expect(result.up.filter(line => line.startsWith("view "))).toEqual([
      expect.stringMatching(
        /^view public_form SELECT id,\s+name\s+FROM form\s+WHERE published; WITH \(security_invoker=true\) GRANT \{=r\//,
      ),
    ])
    expect(result.down).toEqual(result.before)
  })

  it("replaceView with rollback recreate appends columns, and its rollback, which cannot drop them by replacing, creates the view again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        replaceView("public_form", "SELECT id FROM form -- id only", "SELECT id, name FROM form", {
          rollback: "recreate",
        }),
        `${createForm}; CREATE VIEW public_form AS SELECT id FROM form`,
      ),
    )

    expect(result.up).toContain("column public_form.name text")
    expect(result.down).toEqual(result.before)
  })

  it("replaceView fails for a view missing from the target schema rather than creating it", async () => {
    await testTransaction(async () => {
      const step = replaceView("public_form", "SELECT id FROM form", "SELECT id FROM form")

      await expect(applyStep(database, step, createForm)).rejects.toMatchObject({
        code: "42P01",
      })
    })
  })

  it("replaceView fails rollback for a view missing from the target schema rather than creating it", async () => {
    await testTransaction(async () => {
      const step = replaceView("public_form", "SELECT id FROM form", "SELECT id FROM form")

      await expect(applyStep(database, invertStep(step), createForm)).rejects.toMatchObject({
        code: "42P01",
      })
    })
  })

  it("verifyMigrations accepts a history that creates, replaces, and drops a view", async () => {
    const history = defineMigrations({
      "0001_create_form": createTable("form", {
        id: "integer",
        name: "text",
      }),
      "0002_create_public_form": createView("public_form", "SELECT id FROM form"),
      "0003_add_public_form_name": replaceView(
        "public_form",
        "SELECT id FROM form",
        "SELECT id, name FROM form",
        { rollback: "recreate" },
      ),
      "0004_drop_public_form": dropView("public_form", "SELECT id, name FROM form"),
    })

    await testTransaction(() => verifyMigrations(database, history))
  })

  it("verifyMigrations rejects replaceView with rollback recreate of a view with grants, whose rollback loses them", async () => {
    const history = defineMigrations({
      "0001_create_form": createTable("form", {
        id: "integer",
        name: "text",
      }),
      "0002_create_public_form": [
        createView("public_form", "SELECT id FROM form"),
        {
          up: "GRANT SELECT ON public_form TO PUBLIC",
          down: "REVOKE SELECT ON public_form FROM PUBLIC",
        },
      ],
      "0003_add_public_form_name": replaceView(
        "public_form",
        "SELECT id FROM form",
        "SELECT id, name FROM form",
        { rollback: "recreate" },
      ),
    })

    const error = await testTransaction(() => verifyMigrations(database, history)).catch(
      (error: unknown) => error,
    )

    expect((error as Error).message).toStartWith(
      "Rolling back migration 0003_add_public_form_name does not restore the structure of the schema",
    )
  })
})
