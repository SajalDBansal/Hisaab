import { nodeConfig } from "@repo/eslint-config/node";

export default [
  ...nodeConfig,
  {
    // Command-line scripts print to the terminal on purpose
    files: ["src/db/migrate.ts", "src/db/seed.ts"],
    rules: { "no-console": "off" },
  },
];
