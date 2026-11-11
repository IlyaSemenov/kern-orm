import { describe, expect, it } from "bun:test"

import { describePostgres } from "../../testing/postgres"

import { changeSequence, createSequence, dropSequence, renameSequence } from "./sequences"
import { applyStep } from "./testing"

describe("createSequence", () => {
  it("creates a sequence of a quoted name, and drops it", () => {
    expect(createSequence("claim_seq")).toEqual({
      up: 'CREATE SEQUENCE "claim_seq"',
      down: 'DROP SEQUENCE "claim_seq"',
    })
  })

  it("adds the clauses of the options in a fixed order", () => {
    expect(
      createSequence("claim_seq", {
        cycle: true,
        cache: 10,
        start: 100,
        maxValue: 9223372036854775807n,
        minValue: -5,
        increment: -1,
        type: "bigint",
      }).up,
    ).toBe(
      'CREATE SEQUENCE "claim_seq" AS bigint INCREMENT BY -1 MINVALUE -5 MAXVALUE 9223372036854775807 START WITH 100 CACHE 10 CYCLE',
    )
  })

  it("adds nothing for cycle: false", () => {
    expect(createSequence("claim_seq", { cycle: false }).up).toBe('CREATE SEQUENCE "claim_seq"')
  })

  it("throws for a number that is not a safe integer", () => {
    expect(() => createSequence("claim_seq", { start: 1.5 })).toThrow(
      "Cannot create sequence claim_seq: start must be a safe integer or a bigint, got 1.5",
    )
    expect(() => createSequence("claim_seq", { maxValue: 2 ** 53 })).toThrow(
      "maxValue must be a safe integer or a bigint",
    )
  })
})

describe("dropSequence", () => {
  it("drops a sequence, and creates it again as createSequence does", () => {
    expect(dropSequence("claim_seq", { start: 100 })).toEqual({
      up: 'DROP SEQUENCE "claim_seq"',
      down: 'CREATE SEQUENCE "claim_seq" START WITH 100',
    })
  })
})

describe("renameSequence", () => {
  it("renames a sequence, and renames it back", () => {
    expect(renameSequence("claim_seq", "ticket_seq")).toEqual({
      up: 'ALTER SEQUENCE "claim_seq" RENAME TO "ticket_seq"',
      down: 'ALTER SEQUENCE "ticket_seq" RENAME TO "claim_seq"',
    })
  })
})

describe("changeSequence", () => {
  it("changes the options that differ, and changes them back", () => {
    expect(
      changeSequence(
        "claim_seq",
        { increment: 1, maxValue: null, start: 1, cycle: true },
        { increment: 2n, maxValue: 1000, start: 100, cycle: false },
      ),
    ).toEqual({
      up: 'ALTER SEQUENCE "claim_seq" INCREMENT BY 2 MAXVALUE 1000 START WITH 100 NO CYCLE',
      down: 'ALTER SEQUENCE "claim_seq" INCREMENT BY 1 NO MAXVALUE START WITH 1 CYCLE',
    })
  })

  it("sets the bounds that do not differ for a change of type", () => {
    expect(
      changeSequence(
        "claim_seq",
        { type: "bigint", minValue: 1, maxValue: 32767 },
        { type: "smallint", minValue: 1, maxValue: 32767 },
      ),
    ).toEqual({
      up: 'ALTER SEQUENCE "claim_seq" AS smallint MINVALUE 1 MAXVALUE 32767',
      down: 'ALTER SEQUENCE "claim_seq" AS bigint MINVALUE 1 MAXVALUE 32767',
    })
  })

  it("sets the bounds that do not differ for a change of the sign of increment", () => {
    expect(
      changeSequence(
        "claim_seq",
        { increment: 1, minValue: null, maxValue: 100 },
        { increment: -1, minValue: null, maxValue: 100 },
      ),
    ).toEqual({
      up: 'ALTER SEQUENCE "claim_seq" INCREMENT BY -1 NO MINVALUE MAXVALUE 100',
      down: 'ALTER SEQUENCE "claim_seq" INCREMENT BY 1 NO MINVALUE MAXVALUE 100',
    })
  })

  it("throws for a property in one state only", () => {
    expect(() => changeSequence("claim_seq", { start: 1 }, { start: 100, cache: 10 })).toThrow(
      "Cannot change sequence claim_seq: give cache in both states or in neither",
    )
  })

  it("throws for a change of type or of the sign of increment without the bounds", () => {
    expect(() =>
      changeSequence(
        "claim_seq",
        { type: "bigint", minValue: 1 },
        { type: "integer", minValue: 1 },
      ),
    ).toThrow(
      "Cannot change sequence claim_seq: give minValue and maxValue to change type or the sign of increment",
    )
    expect(() => changeSequence("claim_seq", { increment: 1 }, { increment: -1 })).toThrow(
      "give minValue and maxValue to change type or the sign of increment",
    )
  })

  it("throws for a change of type with a bound of null", () => {
    expect(() =>
      changeSequence(
        "claim_seq",
        { type: "bigint", minValue: null, maxValue: 100 },
        { type: "integer", minValue: null, maxValue: 100 },
      ),
    ).toThrow(
      "Cannot change sequence claim_seq: give minValue and maxValue as numbers to change type",
    )
  })

  it("throws when the states change nothing", () => {
    expect(() => changeSequence("claim_seq", { minValue: 10 }, { minValue: 10n })).toThrow(
      "Cannot change sequence claim_seq: the states change nothing",
    )
  })

  it("throws for a number that is not a safe integer", () => {
    expect(() => changeSequence("claim_seq", { start: 1 }, { start: 1.5 })).toThrow(
      "Cannot change sequence claim_seq: start must be a safe integer or a bigint, got 1.5",
    )
  })
})

describePostgres("sequence helpers in PostgreSQL", ({ database, testTransaction }) => {
  const claimOptions = {
    type: "integer",
    increment: 2,
    minValue: 10,
    maxValue: 1000,
    start: 100,
    cache: 5,
    cycle: true,
  } as const

  it("createSequence creates a sequence with its options, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(database, createSequence("claim_seq", claimOptions)),
    )

    expect(result).toEqual({
      before: [],
      up: [
        "sequence claim_seq AS integer START 100 INCREMENT 2 MINVALUE 10 MAXVALUE 1000 CACHE 5 CYCLE",
      ],
      down: [],
    })
  })

  it("dropSequence drops a sequence, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropSequence("claim_seq", claimOptions),
        "CREATE SEQUENCE claim_seq AS integer INCREMENT 2 MINVALUE 10 MAXVALUE 1000 START 100 CACHE 5 CYCLE",
      ),
    )

    expect(result.up).toEqual([])
    expect(result.down).toEqual(result.before)
  })

  it("renameSequence renames a sequence, and its rollback renames it back", async () => {
    const result = await testTransaction(() =>
      applyStep(database, renameSequence("claim_seq", "ticket_seq"), "CREATE SEQUENCE claim_seq"),
    )

    const claimSequence =
      "AS bigint START 1 INCREMENT 1 MINVALUE 1 MAXVALUE 9223372036854775807 CACHE 1"
    expect(result).toEqual({
      before: [`sequence claim_seq ${claimSequence}`],
      up: [`sequence ticket_seq ${claimSequence}`],
      down: [`sequence claim_seq ${claimSequence}`],
    })
  })

  it("changeSequence changes the options of a sequence, and its rollback changes them back", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeSequence(
          "claim_seq",
          {
            type: "bigint",
            increment: 1,
            minValue: -10,
            maxValue: 9223372036854775807n,
            cache: 1,
            cycle: false,
          },
          { type: "integer", increment: -1, minValue: -10, maxValue: 1000, cache: 5, cycle: true },
        ),
        "CREATE SEQUENCE claim_seq MINVALUE -10",
      ),
    )

    expect(result).toEqual({
      before: [
        "sequence claim_seq AS bigint START -10 INCREMENT 1 MINVALUE -10 MAXVALUE 9223372036854775807 CACHE 1",
      ],
      up: [
        "sequence claim_seq AS integer START -10 INCREMENT -1 MINVALUE -10 MAXVALUE 1000 CACHE 5 CYCLE",
      ],
      down: result.before,
    })
  })

  it("changeSequence restores a bound equal to a limit of the type it changes to", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeSequence(
          "claim_seq",
          { type: "bigint", minValue: 1, maxValue: 32767 },
          { type: "smallint", minValue: 1, maxValue: 32767 },
        ),
        "CREATE SEQUENCE claim_seq MAXVALUE 32767",
      ),
    )

    expect(result).toEqual({
      before: [
        "sequence claim_seq AS bigint START 1 INCREMENT 1 MINVALUE 1 MAXVALUE 32767 CACHE 1",
      ],
      up: ["sequence claim_seq AS smallint START 1 INCREMENT 1 MINVALUE 1 MAXVALUE 32767 CACHE 1"],
      down: result.before,
    })
  })

  it("changeSequence sets the default bounds of the direction of increment", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        changeSequence(
          "claim_seq",
          { increment: 1, minValue: null, maxValue: 100, start: 1 },
          { increment: -1, minValue: null, maxValue: 100, start: -1 },
        ),
        "CREATE SEQUENCE claim_seq MAXVALUE 100",
      ),
    )

    expect(result).toEqual({
      before: ["sequence claim_seq AS bigint START 1 INCREMENT 1 MINVALUE 1 MAXVALUE 100 CACHE 1"],
      up: [
        "sequence claim_seq AS bigint START -1 INCREMENT -1 MINVALUE -9223372036854775808 MAXVALUE 100 CACHE 1",
      ],
      down: result.before,
    })
  })
})
