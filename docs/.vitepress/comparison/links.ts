// The links of the evidence of the comparison matrices of the site to the project documentation in the repository.

const repository = "https://github.com/IlyaSemenov/kern-orm/blob/main"

/** Links a record of comparison/ in the repository, such as `nested-rows.md#related-records-in-one-statement`. */
export function research(path: string): string {
  return `${repository}/comparison/${path}`
}

/** Links an item of backlog/ in the repository, such as `joins.md`. */
export function backlog(path: string): string {
  return `${repository}/backlog/${path}`
}
