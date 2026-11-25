# User documentation

How to write the user documentation of kern-orm, the VitePress site in `docs/`, published to GitHub Pages.

## Site

- Keep package READMEs short and link to the site.
- Group the pages of the site by the package they document, ORM, Database, and Migrations, each with a sidebar of its own, and keep the pages of each group in its directory: `docs/orm/`, `docs/database/`, and `docs/migrations/`, each starting with its Getting Started page.
- Add every new page to the sidebar of its package in `docs/.vitepress/config.ts`.
  Choose the section that fits the task and audience of the page, such as Data Model or For Library Authors.
  Within the section, nest a page that specializes another one under it, as Singleton Tables under Tables and Views.
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
- Keep `docs/orm/comparison.md` a summary of [comparison/](../comparison/README.md) for choosing a library, with the reviewed versions and review date and a link to the evidence of each claim about another project.

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
