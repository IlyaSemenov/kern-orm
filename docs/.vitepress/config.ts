import { defineConfig } from "vitepress"

export default defineConfig({
  title: "kern-orm",
  description:
    "Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading",
  base: "/kern-orm/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "ORM", link: "/orm/getting-started", activeMatch: "^/orm/" },
      { text: "Database", link: "/database/getting-started", activeMatch: "^/database/" },
      { text: "Migrations", link: "/migrations/getting-started", activeMatch: "^/migrations/" },
      { text: "Jobs", link: "https://ilyasemenov.github.io/kern-jobs/" },
    ],
    sidebar: {
      "/orm/": [
        {
          text: "ORM",
          items: [
            { text: "Getting Started", link: "/orm/getting-started" },
            { text: "Comparison", link: "/orm/comparison" },
            { text: "Tables and Schemas", link: "/orm/schemas" },
            { text: "Types", link: "/orm/types" },
            {
              text: "Queries",
              link: "/orm/queries/",
              items: [
                { text: "Selecting", link: "/orm/queries/selecting" },
                { text: "Filtering", link: "/orm/queries/filtering" },
                { text: "Related Records", link: "/orm/queries/relations" },
                { text: "Sorting and Pagination", link: "/orm/queries/sorting" },
                { text: "Inserting, Updating, and Deleting", link: "/orm/queries/mutations" },
                { text: "Expressions", link: "/orm/queries/expressions" },
                { text: "Grouping", link: "/orm/queries/grouping" },
                { text: "Operators", link: "/orm/queries/operators" },
                { text: "Composing Queries", link: "/orm/queries/composing" },
                { text: "Reusable Queries", link: "/orm/queries/reusable" },
                { text: "SQL Statements", link: "/orm/queries/sql" },
              ],
            },
            { text: "Transactions", link: "/orm/transactions" },
            { text: "Testing", link: "/orm/testing" },
            { text: "Multiple Schemas", link: "/orm/multiple-schemas" },
            { text: "Singleton Tables", link: "/orm/singleton-tables" },
            { text: "Errors", link: "/orm/errors" },
            {
              text: "Advanced",
              items: [
                { text: "Custom Types", link: "/orm/custom-types" },
                { text: "Interop", link: "/orm/interop" },
                { text: "Orchid ORM Interop", link: "/orm/orchid-interop" },
              ],
            },
          ],
        },
      ],
      "/database/": [
        {
          text: "Database",
          items: [
            { text: "Getting Started", link: "/database/getting-started" },
            { text: "Drivers", link: "/database/drivers" },
            { text: "SQL Queries and Scripts", link: "/database/sql" },
            { text: "Types", link: "/database/types" },
            { text: "Transactions", link: "/database/transactions" },
            { text: "Testing", link: "/database/testing" },
            { text: "Errors", link: "/database/errors" },
            { text: "Interop", link: "/database/interop" },
            { text: "Custom Drivers", link: "/database/custom-drivers" },
            { text: "Building Query Builders", link: "/database/query-builders" },
            { text: "Building Packages", link: "/database/packages" },
          ],
        },
      ],
      "/migrations/": [
        {
          text: "Migrations",
          items: [
            { text: "Getting Started", link: "/migrations/getting-started" },
            { text: "Writing Migrations", link: "/migrations/writing" },
            { text: "Helpers", link: "/migrations/helpers" },
            { text: "Migrations Outside a Transaction", link: "/migrations/outside-transaction" },
            { text: "Applying Migrations", link: "/migrations/applying" },
            { text: "Command Line", link: "/migrations/cli" },
            { text: "Testing Migrations", link: "/migrations/testing" },
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
