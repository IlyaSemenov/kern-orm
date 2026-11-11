import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import type { CliCommand } from "./args"
import { CliUsageError, parseCliArgs } from "./args"

describe("parseCliArgs", () => {
  it.each<[string[], CliCommand]>([
    [["migrate"], { name: "migrate", count: undefined, schemaName: undefined }],
    [["migrate", "2"], { name: "migrate", count: 2, schemaName: undefined }],
    [["rollback"], { name: "rollback", count: undefined, schemaName: undefined }],
    [["rollback", "3"], { name: "rollback", count: 3, schemaName: undefined }],
    [["rollback", "all"], { name: "rollback", count: "all", schemaName: undefined }],
    [["redo", "2"], { name: "redo", count: 2, schemaName: undefined }],
    [["status"], { name: "status", schemaName: undefined }],
    [["new", "add_form_slug"], { name: "new", migrationName: "add_form_slug" }],
    [["new", "добавить-slug2"], { name: "new", migrationName: "добавить-slug2" }],
  ])("parses %j", (args, command) => {
    expect(parseCliArgs(args)).toEqual(command)
  })

  it.each([
    [["--schema", "tenant_acme", "status"]],
    [["status", "--schema", "tenant_acme"]],
    [["status", "-s", "tenant_acme"]],
    [["status", "--schema=tenant_acme"]],
  ])("parses the schema of %j in any position", args => {
    expect(parseCliArgs(args)).toEqual({ name: "status", schemaName: "tenant_acme" })
  })

  it("parses --help and -h with any other arguments, and no command as help that was not requested", () => {
    expect(parseCliArgs(["--help"])).toEqual({ name: "help", requested: true })
    expect(parseCliArgs(["rollback", "-h", "x"])).toEqual({ name: "help", requested: true })
    expect(parseCliArgs([])).toEqual({ name: "help", requested: false })
    expect(parseCliArgs(["--schema", "app"])).toEqual({ name: "help", requested: false })
  })

  it.each([
    ["an unknown command", ["up"], "Unknown command up"],
    ["a count of zero", ["migrate", "0"], "The count of migrate must be a positive integer, not 0"],
    [
      "a count with a leading zero",
      ["redo", "02"],
      "The count of redo must be a positive integer, not 02",
    ],
    [
      "a count that is not decimal",
      ["migrate", "0x10"],
      "The count of migrate must be a positive integer, not 0x10",
    ],
    [
      "all of migrate",
      ["migrate", "all"],
      "The count of migrate must be a positive integer, not all",
    ],
    [
      "a count beyond safe integers",
      ["rollback", "9007199254740993"],
      "The count of rollback must be a positive integer or all, not 9007199254740993",
    ],
    ["two counts", ["rollback", "1", "2"], "rollback takes one count at most"],
    ["arguments of status", ["status", "all"], "status takes no arguments"],
    [
      "new without a name",
      ["new"],
      "new takes the name of the migration, such as new add_form_slug",
    ],
    [
      "new with two names",
      ["new", "add", "slug"],
      "new takes the name of the migration, such as new add_form_slug",
    ],
    [
      "a name with a dot",
      ["new", "add.slug"],
      "The name of a migration must have only letters, digits, _, and -, such as add_form_slug, not add.slug",
    ],
    [
      "a name with whitespace",
      ["new", "add slug"],
      "The name of a migration must have only letters, digits, _, and -, such as add_form_slug, not add slug",
    ],
    [
      "a name with #, which an import specifier reads as a fragment",
      ["new", "add#slug"],
      "The name of a migration must have only letters, digits, _, and -, such as add_form_slug, not add#slug",
    ],
    [
      "a name with a slash",
      ["new", "forms/add_slug"],
      "The name of a migration must have only letters, digits, _, and -, such as add_form_slug, not forms/add_slug",
    ],
    ["--schema of new", ["new", "add_slug", "--schema", "app"], "new takes no --schema"],
    [
      "an empty --schema",
      ["status", "--schema="],
      "--schema requires the name of a PostgreSQL schema",
    ],
  ])("rejects %s", (_, args, message) => {
    expect(getThrownError(() => parseCliArgs(args))).toEqual(new CliUsageError(message))
  })

  it.each([
    ["an unknown option", ["status", "--force"]],
    ["--schema without its value", ["status", "--schema"]],
  ])("rejects %s with the message of parseArgs", (_, args) => {
    expect(() => parseCliArgs(args)).toThrow(CliUsageError)
  })
})
