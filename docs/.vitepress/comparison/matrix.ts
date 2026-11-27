// The model of the comparison matrices of the site, which ComparisonMatrix renders, and the links of their evidence.

/**
 * What a project offers for a feature, by what it can do rather than by how close it is to Kern.
 *
 * - `supported`: built in.
 * - `limited`: with limitations, or composed by hand from lower-level parts.
 * - `external`: through a separate library.
 * - `preview`: behind a preview or experimental feature.
 * - `unsupported`: missing, or present but broken in the reviewed version.
 * - `declined`: missing because its maintainers declined it, which the cell links.
 * - `unknown`: not reviewed yet, which never stands for `unsupported`.
 */
export type Status =
  | "supported"
  | "limited"
  | "external"
  | "preview"
  | "unsupported"
  | "declined"
  | "unknown"

/** A cell of a project for a feature, with the reason of its status and the evidence of it. */
export type CellDetails = CellFields &
  (
    | { status: Exclude<Status, "declined"> }
    // A `declined` cell links the decision of the maintainers.
    | { status: "declined"; href: string }
  )

/** The fields of a cell beside its status. */
interface CellFields {
  /** One or two sentences of what the project does, with code in backticks. */
  note?: string
  /** The evidence: a page of the site, starting with `/`, or a source of the project. */
  href?: string
  /** The version of the project that the evidence describes, when it differs from the version of its column. */
  version?: string
  /** The item of backlog/ that would add a missing feature to Kern, which the `backlog` function links. */
  plan?: string
}

/** A cell of a project for a feature: a status alone, except `declined`, or a status with its details. */
export type Cell = Exclude<Status, "declined"> | CellDetails

/** A column of the matrix. */
export interface Project<Id extends string = string> {
  id: Id
  name: string
  /** The version that the column describes unless a cell names another one. */
  version: string
  url?: string
}

/** A row of the matrix. */
export interface Feature<Id extends string = string> {
  /** The anchor of the row, unique on its page. */
  id: string
  title: string
  /** One or two sentences of what the feature does for an application. */
  description: string
  /** The record of the feature in comparison/, which the `research` function links. */
  research?: string
  cells: Record<Id, Cell>
}

/** A titled group of rows. */
export interface Group<Id extends string = string> {
  /** The anchor of the group, unique on its page. */
  id: string
  title: string
  /** A page that compares the features of the group in more detail, such as the matrix of another library. */
  link?: { text: string; href: string }
  features: readonly Feature<Id>[]
}

/** The projects and the rows of a comparison page. */
export interface Matrix {
  projects: readonly Project[]
  groups: readonly Group[]
}

/** Defines a matrix whose rows give a cell for every project, the first of which is the Kern library of the page. */
export function defineMatrix<const Id extends string>(matrix: {
  projects: readonly Project<Id>[]
  groups: readonly Group<NoInfer<Id>>[]
}): Matrix {
  return matrix
}

/** Gives the details of a cell, also of a cell of a status alone. */
export function toCellDetails(cell: Cell): CellDetails {
  return typeof cell === "string" ? { status: cell } : cell
}

const repository = "https://github.com/IlyaSemenov/kern-orm/blob/main"

/** Links a record of comparison/ in the repository, such as `nested-rows.md#related-records-in-one-statement`. */
export function research(path: string): string {
  return `${repository}/comparison/${path}`
}

/** Links an item of backlog/ in the repository, such as `joins.md`. */
export function backlog(path: string): string {
  return `${repository}/backlog/${path}`
}
