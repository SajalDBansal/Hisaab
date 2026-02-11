# Shared Lint Profiles

Shared ESLint configurations for workspace development and manual checks.

| Profile                      | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `@repo/eslint-config/node`   | Node and shared server packages.                                            |
| `@repo/eslint-config/core`   | Framework-free TypeScript with equality, unused-binding and console checks. |
| `@repo/eslint-config/native` | Expo/browser globals, TypeScript rules and React Hooks checks.              |

Prettier owns formatting. Generated output, platform-generated native projects
and installed dependencies are ignored. The profiles do not apply autofixes.

Core/native type-only import findings are warnings. Native unused bindings,
console statements and Hooks dependency findings are also warnings; conditional
Hooks and recommended correctness violations remain errors. Explicit `_`
prefixes may mark intentionally unused bindings.

Core's `src/reporting/format.ts` permits control-character regular expressions
for CSV formula-injection protection. Keep that protection when changing rules.

After installing workspace dependencies, use `bun run lint` from a package
that exposes the command. Review findings in context before changing code.
