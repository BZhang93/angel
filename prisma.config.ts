import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations/introspection use the direct connection (port 5432); the
    // transaction pooler does not support the prepared statements migrate issues.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
