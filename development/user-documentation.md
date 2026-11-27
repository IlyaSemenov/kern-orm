# User documentation

How to write the user documentation of kern-orm, the VitePress site in `docs/`, published to GitHub Pages.

## Site

- Keep package READMEs short and link to the site.
- Group the pages of the site by the package they document, ORM, Database, and Migrations, each with a sidebar of its own, and keep the pages of each group in its directory: `docs/orm/`, `docs/database/`, and `docs/migrations/`, each starting with its Getting Started page.
- Add every new page to the sidebar of its package in `docs/.vitepress/config.ts`.
  Choose the section that fits the task and audience of the page, such as Data Model or For Library Authors.
  Within the section, nest a page that specializes another one under it, as Singleton Tables under Tables.
  Do not add a section of leftovers, such as Advanced.
- When a sidebar label is clear only under its section, such as Overview, set `docFooterText` to a name of the page that is clear on its own, for the previous and next links at the bottom of pages.
- Keep the Next steps of each Getting Started page in the order of the sidebar.
- Write the pages of the ORM group for an application of kern-orm, with a `Db` and imports from `kern-orm` and its subpaths, and the pages of the Database group for code without the ORM, with a `database` and imports from `kern-db` and its subpaths.
- Document types, transactions, interop with other libraries, test helpers, and errors, which both packages give, on a page of each group with examples of its own API, and update both pages with a change of what they share; document drivers and custom drivers in the Database group alone.
- Write each page of the Database group for users of kern-db alone, without a box or a note that links its counterpart in the ORM group.
- Give every `info` box a title of its own, since VitePress titles it `INFO` otherwise.
- Keep material for authors of extensions, such as custom types and operators, custom drivers, and custom migration helpers, on pages of their own in the group of their package, separate from the guides for using the API.
- Keep the overview of the Kern libraries, including kern-jobs, which has its own repository, in `docs/ecosystem.md`, outside the groups.
  Link the overview from the Kern menu of the nav.
  When a package joins the family or changes what it is for, update the overview and the Kern libraries sections of the READMEs.
- Keep `docs/orm/comparison.md` and `docs/migrations/comparison.md` matrices of features for choosing a library, whose rows `docs/.vitepress/comparison/orm.ts` and `docs/.vitepress/comparison/migrations.ts` define, with the review date, and link each page from the other by a line of links under its title:
  - Take the status of a cell of another project from a record of [comparison/](../comparison/README.md), or, for a feature that the Kern library of the page lacks, from the item of [backlog/](../backlog/README.md) that keeps the capability of the project, and link the source that the record cites, with its version when it differs from the version of its column.
    Link the record of comparison/ from its row, if there is one.
  - Choose the status of a cell by what the project can do for the feature, not by the verdict of the record, which compares it with Kern: a project that `differs` may support the feature.
  - Give a project `unsupported` for a defect only when its listed version has the defect, and `declined` only when the cell links the decision of its maintainers, such as a closed issue.
  - Leave out the cell of another project until such a record checks it, which makes it `unknown`.
    Give a cell with a note but without such a record the status `unknown`.
  - Keep the rows an inventory of what users can build and operate with the Kern library: the features that its site documents, and the features of other projects that it lacks, rather than the items of backlog/ alone.
    Give a feature of the inventory a row before its review, also with every other cell `unknown`.
  - Name a row by the capability that its cells judge.
    When the Kern library lacks only a convenience for what it does another way, name the convenience rather than the broader capability, such as Reversible helpers that change enum values rather than Changes of enum types, or tell the other way in the note of its cell, such as a fragment of `sql(type)` for a missing operator.
  - From the cell of the Kern library of a feature that it lacks, link the item of backlog/ that would add it, or explain a feature that it leaves out by design, such as databases other than PostgreSQL, linking what to do instead when the site documents it.

## Publishing

- Each run of `.github/workflows/docs.yml` on `main` publishes the site from `main`, so run `gh workflow run docs.yml` to repair or redeploy it.
- Test a change of the workflow with `gh workflow run docs.yml --ref <branch>`, which builds the site of that branch without deploying it.

## Content

- Write user documentation as a guide to using the API in plain terms: what to call and what it does, not how it is typed or implemented.
- Start each page and section from what users want to achieve in their application, such as sharing tables between tenant and SaaS schemas, rather than from a description of the project or its concepts.
  Name only a task that users really have; when none fits, state plainly what the API does instead of inventing a task for a "To …" opening.
  Open with a short statement of the common case and its example, and put details, alternatives, and edge cases after the example.
- Other things being equal, write the happy path as an instruction of what to do, such as "Pass the values to `where`", rather than as a description of the API, such as "`where` takes values".
  This is a preference, not a rule: keep a description wherever it reads more clearly.
- Do not restate in prose what users see in their editor's types or learn from a TypeScript or runtime error.
- Document every guarantee that the application relies on, such as of transactions, the results of queries, and migrations.
  Mention another edge case only when users of the feature need it to use the library, not merely because rare code, such as of an uncommon PostgreSQL command, must change for it; record other edge cases, typing rules, and invariants in [architecture/](../architecture/README.md) and cover them with tests.
- Write a rule of how users must do something as an instruction, such as to include each table under one key, rather than as the check or error that enforces it.
- State a limitation, something that users cannot do, as a description, such as "A query with `distinct` cannot select related records", rather than as an instruction to avoid it, unless the description loses clarity.

## Examples

- Name the `Db` `db`, the schema `schema`, and other such values by their kind, such as `database`, unless the page uses several of one kind; then name each by its role, such as `tenantDb` and `saasDb`.
