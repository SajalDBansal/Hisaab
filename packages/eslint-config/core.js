import { typescriptConfig } from "./typescript.js";

export const coreConfig = [
  ...typescriptConfig,
  { rules: { "no-console": "error" } },
  {
    // CSV formula protection deliberately matches leading control characters.
    files: ["src/reporting/format.ts"],
    rules: { "no-control-regex": "off" },
  },
];

export default coreConfig;
