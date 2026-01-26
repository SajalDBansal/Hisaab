import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// Recommended correctness checks leave formatting and type analysis to their own tools.
export const typescriptConfig = tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "coverage/**", ".turbo/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Existing mixed type/value imports are visible without a repository-wide style rewrite.
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  prettier,
  { rules: { eqeqeq: ["error", "always"] } },
);
