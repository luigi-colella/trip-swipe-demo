import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside the React Server runtime; it's a no-op in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    env: { LLM_MODE: "fake" },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          setupFiles: ["tests/setup/msw.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          // React components rendered in isolation (Testing Library + happy-dom).
          environment: "happy-dom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/setup/components.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Every file in src/ counts, tested or not; there are no exclusions.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "text", "html"],
      thresholds: { 100: true },
    },
  },
});
