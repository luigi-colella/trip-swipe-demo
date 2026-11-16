import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test reports.
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    // The LangSmith SDK is used here only. Its deprecated methods call API endpoints that stop
    // working (e.g. listRuns → v1 runs/query, removed after 2027-01-31): use the replacements.
    files: ["scripts/**/*.ts", "evals/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { "@typescript-eslint/no-deprecated": "error" },
  },
]);

export default eslintConfig;
