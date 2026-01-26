import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

export const nextJsConfig = [
  { ignores: ["node_modules/**", "dist/**", "coverage/**", ".turbo/**"] },
  js.configs.recommended,
  ...nextVitals,
  ...nextTypescript,
  prettier,
  {
    files: ["**/*.ts", "**/*.tsx"],
    // Match the shared TypeScript rules using Next's own plugin instance.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  { rules: { eqeqeq: ["error", "always"] } },
];
