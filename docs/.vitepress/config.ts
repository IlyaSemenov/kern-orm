import { defineConfig } from "vitepress"

export default defineConfig({
  title: "kern-orm",
  description:
    "Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading",
  // Served from https://ilyasemenov.github.io/kern-orm/
  base: "/kern-orm/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [{ text: "Docs", link: "/getting-started" }],
    sidebar: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "Drivers", link: "/drivers" },
      { text: "Tables and Schemas", link: "/schemas" },
      { text: "Types", link: "/types" },
      {
        text: "Queries",
        link: "/queries/",
        items: [
          { text: "Selecting", link: "/queries/selecting" },
          { text: "Filtering", link: "/queries/filtering" },
          { text: "Sorting and Pagination", link: "/queries/sorting" },
          { text: "Related Records", link: "/queries/relations" },
          { text: "Inserting, Updating, and Deleting", link: "/queries/mutations" },
          { text: "Composing Queries", link: "/queries/composing" },
          { text: "Reusable Queries", link: "/queries/reusable" },
          { text: "SQL Statements", link: "/queries/sql" },
        ],
      },
      { text: "Multiple Schemas", link: "/multiple-schemas" },
      { text: "Transactions", link: "/transactions" },
      { text: "Testing", link: "/testing" },
      {
        text: "Advanced",
        items: [{ text: "Custom Types", link: "/custom-types" }],
      },
    ],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/IlyaSemenov/kern-orm/edit/main/docs/:path",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/IlyaSemenov/kern-orm" }],
  },
})
