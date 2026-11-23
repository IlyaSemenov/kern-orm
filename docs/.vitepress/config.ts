import { defineConfig } from "vitepress"

export default defineConfig({
  title: "kern-orm",
  description:
    "Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading",
  base: "/kern-orm/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    outline: [2, 3],
    nav: [
      { text: "ORM", link: "/orm/getting-started", activeMatch: "^/orm/" },
      { text: "Database", link: "/database/getting-started", activeMatch: "^/database/" },
      { text: "Migrations", link: "/migrations/getting-started", activeMatch: "^/migrations/" },
      { text: "Jobs", link: "https://ilyasemenov.github.io/kern-jobs/" },
    ],
    sidebar: {
      "/orm/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/orm/getting-started" },
            { text: "Comparison", link: "/orm/comparison" },
          ],
        },
        {
          text: "Data Model",
          items: [
            {
              text: "Tables and Views",
              link: "/orm/tables",
              items: [{ text: "Singleton Tables", link: "/orm/singleton-tables" }],
            },
            {
              text: "Schemas and Relations",
              link: "/orm/schemas",
              items: [{ text: "Multiple Schemas", link: "/orm/multiple-schemas" }],
            },
            {
              text: "Types",
              link: "/orm/types",
              items: [{ text: "Custom Types", link: "/orm/custom-types" }],
            },
          ],
        },
        {
          text: "Queries",
          items: [
            { text: "Overview", link: "/orm/queries/", docFooterText: "Queries" },
            { text: "Selecting", link: "/orm/queries/selecting" },
            { text: "Filtering", link: "/orm/queries/filtering" },
            { text: "Related Records", link: "/orm/queries/relations" },
            { text: "Sorting and Pagination", link: "/orm/queries/sorting" },
            { text: "Inserting, Updating, and Deleting", link: "/orm/queries/mutations" },
            { text: "Aggregates and Grouping", link: "/orm/queries/aggregates" },
            { text: "Expressions", link: "/orm/queries/expressions" },
            { text: "Operators", link: "/orm/queries/operators" },
            { text: "Composing Queries", link: "/orm/queries/composing" },
            { text: "Reusable Queries", link: "/orm/queries/reusable" },
            { text: "SQL Statements", link: "/orm/queries/sql" },
          ],
        },
        {
          text: "Execution and Testing",
          items: [
            { text: "Transactions", link: "/orm/transactions" },
            { text: "Locks", link: "/orm/locks" },
            { text: "Sessions", link: "/orm/sessions" },
            { text: "Testing", link: "/orm/testing" },
            { text: "Errors", link: "/orm/errors" },
          ],
        },
        {
          text: "Interop",
          items: [
            {
              text: "Other Libraries",
              link: "/orm/interop",
              docFooterText: "Interop with Other Libraries",
            },
            {
              text: "Orchid ORM",
              link: "/orm/orchid-interop",
              docFooterText: "Orchid ORM Interop",
            },
          ],
        },
      ],
      "/database/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting Started", link: "/database/getting-started" },
            { text: "Drivers", link: "/database/drivers" },
          ],
        },
        {
          text: "Queries",
          items: [
            { text: "SQL Queries and Scripts", link: "/database/sql" },
            { text: "Types", link: "/database/types" },
          ],
        },
        {
          text: "Execution and Testing",
          items: [
            { text: "Transactions", link: "/database/transactions" },
            { text: "Locks", link: "/database/locks" },
            { text: "Sessions", link: "/database/sessions" },
            { text: "Testing", link: "/database/testing" },
            { text: "Errors", link: "/database/errors" },
            { text: "Interop with Other Libraries", link: "/database/interop" },
          ],
        },
        {
          text: "For Library Authors",
          items: [
            { text: "Custom Drivers", link: "/database/custom-drivers" },
            { text: "Building Query Builders", link: "/database/query-builders" },
            { text: "Building Packages", link: "/database/packages" },
          ],
        },
      ],
      "/migrations/": [
        {
          text: "Introduction",
          items: [{ text: "Getting Started", link: "/migrations/getting-started" }],
        },
        {
          text: "Writing",
          items: [
            { text: "Writing Migrations", link: "/migrations/writing" },
            { text: "Schema Helpers", link: "/migrations/helpers" },
            { text: "Migrations Outside a Transaction", link: "/migrations/outside-transaction" },
          ],
        },
        {
          text: "Running and Testing",
          items: [
            { text: "Applying Migrations", link: "/migrations/applying" },
            { text: "Command Line", link: "/migrations/cli" },
            { text: "Testing Migrations", link: "/migrations/testing" },
          ],
        },
        {
          text: "Extending",
          items: [
            { text: "Custom Migration Helpers", link: "/migrations/custom-helpers" },
            { text: "Migrations in a Package", link: "/migrations/package-migrations" },
          ],
        },
      ],
    },
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/IlyaSemenov/kern-orm/edit/main/docs/:path",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/IlyaSemenov/kern-orm" }],
  },
})
