import { defineConfig } from "tsup";
export default defineConfig({
  entry: { server: "src/server.ts" },
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@repo\//],
});
