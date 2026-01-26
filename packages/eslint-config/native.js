import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { typescriptConfig } from "./typescript.js";

export const nativeConfig = [
  {
    ignores: [
      ".expo/**",
      "web-build/**",
      "android/**",
      "ios/**",
      "expo-env.d.ts",
    ],
  },
  ...typescriptConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        __DEV__: "readonly",
        process: "readonly",
        global: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-console": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Existing native cleanup is reported while concurrently edited screens remain untouched.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["metro.config.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
];

export default nativeConfig;
