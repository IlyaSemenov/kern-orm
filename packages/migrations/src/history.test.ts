import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { MigrationError } from "./error"
import { defineMigrations, listHistoryKeys, listKeysAfterBaseline } from "./history"
import type { MigrationStep } from "./migration"

const load = async () => ({ default: { up: "SELECT 1" } })

describe("defineMigrations", () => {
  it("orders migrations by their numbers and takes the keys of paths from their file names", () => {
    const history = defineMigrations({
      "./migrations/10_add_email.ts": load,
      "./migrations/0002_create_user.ts": load,
      "0001_create_form": load,
    })

    expect(history.keys).toEqual(["0001_create_form", "0002_create_user", "10_add_email"])
  })

  it("takes migrations themselves beside loaders, by key or by path", () => {
    const history = defineMigrations({
      "0003_add_email": load,
      "./migrations/0002_create_user.ts": [{ up: "CREATE TABLE app_user (id integer)" }],
      "0001_create_form": { up: "CREATE TABLE form (id integer)" },
    })

    expect(history.keys).toEqual(["0001_create_form", "0002_create_user", "0003_add_email"])
  })

  it("defaults the table of versions and lists no schemas after the target schema", () => {
    expect(defineMigrations({})).toMatchObject({ tableName: "kern_migration", searchPath: [] })
    expect(
      defineMigrations({}, { tableName: "migration", searchPath: ["extensions"] }),
    ).toMatchObject({ tableName: "migration", searchPath: ["extensions"] })
  })

  it.each([
    "create_form",
    "0001",
    "0001_",
    "./migrations/0001_create_form.sql.ts",
    "0001_create form",
  ])("rejects key %s", name => {
    expect(() => defineMigrations({ [name]: load })).toThrow(
      `Migration ${name} must be named <number>_<name>, such as 0001_create_form, without dots`,
    )
  })

  it("rejects a path of a file of migration tests, such as of import.meta.glob of all modules of the directory", () => {
    expect(() =>
      defineMigrations({
        "./migrations/0001_create_form.ts": load,
        "./migrations/0001_create_form.migration-test.ts": load,
      }),
    ).toThrow(
      './migrations/0001_create_form.migration-test.ts is a file of migration tests rather than a migration: exclude migration tests from the modules of the history, such as with "!./migrations/*.migration-test.ts" in the patterns of import.meta.glob',
    )
  })

  it("rejects two keys of one number, such as of two branches", () => {
    expect(() =>
      defineMigrations({
        "0002_create_user": load,
        "./migrations/2_create_tag.ts": load,
        "0001_create_form": load,
      }),
    ).toThrow(
      "Migrations 0002_create_user and 2_create_tag have the same number: give each migration its own number",
    )
  })

  it.each([
    ["undefined", undefined],
    ["a string", "CREATE TABLE form (id integer)"],
    ["an empty array", []],
  ])("rejects %s as a migration when it is called", (_, value) => {
    expect(
      getThrownError(() =>
        defineMigrations({ "0001_create_form": value as unknown as MigrationStep }),
      ),
    ).toEqual(
      new MigrationError(
        "Migration 0001_create_form must be the loader of its module, a step, or a non-empty array of steps",
        { key: "0001_create_form" },
      ),
    )
  })

  it("rejects a migration with a problem of a step when it is called, rather than when it is applied", () => {
    expect(
      getThrownError(() =>
        defineMigrations({
          "0001_create_form": {
            up: "CREATE TABLE form (id integer)",
            donw: "DROP TABLE form",
          } as MigrationStep,
        }),
      ),
    ).toEqual(
      new MigrationError("Step 1 of migration 0001_create_form has unknown property donw", {
        key: "0001_create_form",
        step: 1,
      }),
    )
  })
})

describe("baseline", () => {
  const baseline = { up: "CREATE TABLE form (id integer, slug text)", down: "DROP TABLE form" }

  it("keeps the keys that the baseline replaces apart from the keys of the migrations that the history can load", () => {
    const history = defineMigrations(
      { "0003_create_user": load },
      { baseline: { migration: baseline, replaces: ["0001_create_form", "0002_add_form_slug"] } },
    )

    expect(history.keys).toEqual(["0003_create_user"])
    expect(history.baseline?.replaces).toEqual(["0001_create_form", "0002_add_form_slug"])
    expect(listHistoryKeys(history)).toEqual([
      "0001_create_form",
      "0002_add_form_slug",
      "0003_create_user",
    ])
    expect(listKeysAfterBaseline(history)).toEqual(["0003_create_user"])
  })

  it.each([
    ["all of them", ["0001_create_form", "0002_add_form_slug", "0003_drop_form_name"]],
    ["the last ones", ["0002_add_form_slug", "0003_drop_form_name"]],
    ["none", []],
  ])("lets the history keep the modules of the replaced migrations: %s", (_, kept) => {
    const history = defineMigrations(
      { ...Object.fromEntries(kept.map(key => [key, load])), "0004_create_user": load },
      {
        baseline: {
          migration: baseline,
          replaces: ["0001_create_form", "0002_add_form_slug", "0003_drop_form_name"],
        },
      },
    )

    expect(history.keys).toEqual([...kept, "0004_create_user"])
    expect(listHistoryKeys(history)).toEqual([
      "0001_create_form",
      "0002_add_form_slug",
      "0003_drop_form_name",
      "0004_create_user",
    ])
    expect(listKeysAfterBaseline(history)).toEqual(["0004_create_user"])
  })

  it("takes replaces shortened to its last keys, such as after every target has applied the first ones", () => {
    const history = defineMigrations(
      { "0100_create_user": load },
      { baseline: { migration: baseline, replaces: ["0099_add_form_slug"] } },
    )

    expect(listHistoryKeys(history)).toEqual(["0099_add_form_slug", "0100_create_user"])
  })

  it("lists the keys of a history without a baseline as they are", () => {
    const history = defineMigrations({ "0001_create_form": load })

    expect(listHistoryKeys(history)).toBe(history.keys)
    expect(listKeysAfterBaseline(history)).toBe(history.keys)
  })

  it.each([
    ["no replaces", undefined],
    ["empty replaces", []],
    ["replaces that is not an array", "0001_create_form"],
  ])("rejects %s", (_, replaces) => {
    expect(() =>
      defineMigrations({}, { baseline: { migration: baseline, replaces: replaces as never } }),
    ).toThrow(
      "The baseline of a history requires replaces: the keys of the migrations that it replaces, in order",
    )
  })

  it.each(["create_form", "0001", "0001_create.form", "0001_form/detail", 1])(
    "rejects replaced key %p of another form",
    key => {
      expect(() =>
        defineMigrations({}, { baseline: { migration: baseline, replaces: [key as never] } }),
      ).toThrow(
        `Replaced migration ${key} must be named <number>_<name>, such as 0001_create_form, without dots or slashes`,
      )
    },
  )

  it.each([
    ["out of order", ["0002_add_form_slug", "0001_create_form"], "0001_create_form"],
    ["of one number", ["0001_create_form", "1_create_tag"], "1_create_tag"],
    ["listed twice", ["0001_create_form", "0001_create_form"], "0001_create_form"],
  ])("rejects replaced keys %s", (_, replaces, key) => {
    expect(() => defineMigrations({}, { baseline: { migration: baseline, replaces } })).toThrow(
      `Replaced migration ${key} must follow ${replaces[0]!}: list the migrations that the baseline replaces in the order of their numbers, each once`,
    )
  })

  it.each([
    ["before the replaced keys", "0001_create_tag"],
    ["between the replaced keys", "0003_create_tag"],
    ["of the number of a replaced key", "4_create_tag"],
  ])(
    "rejects a migration %s that replaces lacks, which a target that the baseline built would never apply",
    (_, key) => {
      expect(() =>
        defineMigrations(
          { [key]: load, "0005_create_user": load },
          {
            baseline: { migration: baseline, replaces: ["0002_create_form", "0004_add_form_slug"] },
          },
        ),
      ).toThrow(
        `Migration ${key} does not follow 0004_add_form_slug, the last migration that the baseline replaces, and replaces lacks it: give a new migration a number after that migration; if the baseline already includes the changes of this migration, add it to replaces`,
      )
    },
  )

  it.each([
    ["the first one alone", ["0001_create_form"], "0001_create_form without 0003_drop_form_name"],
    [
      "the first ones without the last",
      ["0001_create_form", "0002_add_form_slug"],
      "0002_add_form_slug without 0003_drop_form_name",
    ],
    [
      "the last one after a gap",
      ["0001_create_form", "0003_drop_form_name"],
      "0001_create_form without 0002_add_form_slug",
    ],
  ])(
    "rejects a history that keeps replaced migrations other than the last ones: %s",
    (_, kept, gap) => {
      expect(() =>
        defineMigrations(Object.fromEntries(kept.map(key => [key, load])), {
          baseline: {
            migration: baseline,
            replaces: ["0001_create_form", "0002_add_form_slug", "0003_drop_form_name"],
          },
        }),
      ).toThrow(
        `The history has replaced migration ${gap}, which follows it: keep the modules of the last migrations that the baseline replaces without a gap, or of none`,
      )
    },
  )

  it.each([
    ["undefined", undefined],
    ["a string", "CREATE TABLE form (id integer)"],
    ["an empty array", []],
  ])(
    "rejects %s as a baseline when it is called, with a MigrationError without a key",
    (_, value) => {
      expect(
        getThrownError(() =>
          defineMigrations(
            {},
            {
              baseline: {
                migration: value as unknown as MigrationStep,
                replaces: ["0001_create_form"],
              },
            },
          ),
        ),
      ).toEqual(
        new MigrationError(
          "The baseline must be the loader of its module, a step, or a non-empty array of steps",
          { key: undefined },
        ),
      )
    },
  )

  it("rejects a baseline with changes outside a transaction when it is called, since it records the replaced keys in its transaction", () => {
    expect(
      getThrownError(() =>
        defineMigrations(
          {},
          {
            baseline: {
              migration: { ...baseline, outsideTransaction: { up: baseline.up } },
              replaces: ["0001_create_form"],
            },
          },
        ),
      ),
    ).toEqual(
      new MigrationError(
        "Step 1 of the baseline has outsideTransaction, which a baseline cannot have, since it records the migrations that it replaces in its transaction",
        { key: undefined, step: 1 },
      ),
    )
  })

  it("loads the module of the baseline only when called and returns its steps", async () => {
    let loads = 0
    const history = defineMigrations(
      {},
      {
        baseline: {
          migration: async () => {
            loads++
            return { default: baseline }
          },
          replaces: ["0001_create_form"],
        },
      },
    )

    expect(loads).toBe(0)
    expect(await history.baseline!.load()).toEqual([baseline])
    expect(loads).toBe(1)
  })

  it("rejects a module of the baseline that fails to load, exports no migration, or has changes outside a transaction, with a MigrationError without a key", async () => {
    const failure = new Error("Cannot find module")
    const loadBaseline = (migration: () => Promise<unknown>) =>
      defineMigrations({}, { baseline: { migration, replaces: ["0001_create_form"] } })
        .baseline!.load()
        .catch((error: unknown) => error)

    expect(await loadBaseline(() => Promise.reject(failure))).toEqual(
      new MigrationError("Cannot load the baseline: Cannot find module", {
        key: undefined,
        cause: failure,
      }),
    )
    expect(await loadBaseline(async () => baseline)).toEqual(
      new MigrationError(
        "The baseline must export a step or a non-empty array of steps as its default export",
        { key: undefined },
      ),
    )
    expect(
      await loadBaseline(async () => ({
        default: [{ ...baseline, outsideTransaction: { up: baseline.up } }, baseline],
      })),
    ).toEqual(
      new MigrationError(
        "Step 1 of the baseline has outsideTransaction, which a baseline cannot have, since it records the migrations that it replaces in its transaction",
        { key: undefined, step: 1 },
      ),
    )
  })
})

describe("load", () => {
  it("loads the module of a migration only when called and returns its steps", async () => {
    const loaded: string[] = []
    const history = defineMigrations({
      "0001_create_form": async () => {
        loaded.push("0001_create_form")
        return { default: { up: "CREATE TABLE form (id integer)" } }
      },
      "0002_create_user": async () => {
        loaded.push("0002_create_user")
        return { default: [{ up: "CREATE TABLE app_user (id integer)" }] }
      },
    })

    expect(loaded).toEqual([])
    expect(await history.load("0002_create_user")).toEqual([
      { up: "CREATE TABLE app_user (id integer)" },
    ])
    expect(loaded).toEqual(["0002_create_user"])
  })

  it("returns the steps of a migration given as a value", async () => {
    const steps = [
      { up: "CREATE TABLE form (id integer)" },
      { up: "CREATE TABLE app_user (id integer)" },
    ]
    const history = defineMigrations({
      "0001_create_form": steps,
      "0002_create_tag": { up: "CREATE TABLE tag (id integer)" },
    })

    expect(await history.load("0001_create_form")).toBe(steps)
    expect(await history.load("0002_create_tag")).toEqual([{ up: "CREATE TABLE tag (id integer)" }])
  })

  // rake-db shared the changes of migrations of two histories under one key: https://github.com/romeerez/orchid-orm/issues/764
  it("loads the migration of its own history for a key of another history", async () => {
    const tenantHistory = defineMigrations({
      "0001_init": async () => ({ default: { up: "CREATE TABLE form (id integer)" } }),
    })
    const saasHistory = defineMigrations({
      "0001_init": async () => ({ default: { up: "CREATE TABLE tenant (id integer)" } }),
    })

    expect(await tenantHistory.load("0001_init")).toEqual([
      { up: "CREATE TABLE form (id integer)" },
    ])
    expect(await saasHistory.load("0001_init")).toEqual([
      { up: "CREATE TABLE tenant (id integer)" },
    ])
  })

  it("rejects a module that fails to load with a MigrationError of its key", async () => {
    const failure = new Error("Cannot find module")
    const history = defineMigrations({
      "0001_create_form": () => Promise.reject(failure),
    })

    const error = await history.load("0001_create_form").catch((error: unknown) => error)

    expect(error).toBeInstanceOf(MigrationError)
    expect(error).toMatchObject({
      message: "Cannot load migration 0001_create_form: Cannot find module",
      key: "0001_create_form",
      step: undefined,
      cause: failure,
    })
  })

  it("rejects a module without a migration as its default export", async () => {
    const history = defineMigrations({
      "0001_create_form": async () => ({ up: "CREATE TABLE form (id integer)" }),
    })

    await expect(history.load("0001_create_form")).rejects.toThrow(
      "Migration 0001_create_form must export a step or a non-empty array of steps as its default export",
    )
  })

  it("rejects a key that the history lacks", async () => {
    await expect(defineMigrations({}).load("0001_create_form")).rejects.toThrow(
      "The history has no migration 0001_create_form",
    )
  })
})
