import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/worker.ts", "src/healthcheck.ts"],
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@repo\//],
});
