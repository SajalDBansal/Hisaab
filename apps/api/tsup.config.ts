import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", migrate: "src/db/migrate.ts" },
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // @repo/* packages ship TypeScript source, so they are compiled into the bundle
  noExternal: [/^@repo\//],
});
