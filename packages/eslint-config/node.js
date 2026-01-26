import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint rules for Node/TypeScript code (the API and its workers).
 * Prettier owns formatting, so no style rules here, only things that catch bugs.
 */
export const nodeConfig = tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
  prettier,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Forgotten `await` on a database call is the classic way to lose a write
      "no-return-await": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Console output skips the structured logger and its request id
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
);

export default nodeConfig;
