import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    worker: "src/worker.ts",
    healthcheck: "src/healthcheck.ts",
    backup: "src/backup/operator.ts",
  },
  format: "esm",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@repo\//],
});
