import { defineConfig } from "vitest/config";

// Separate from ../vitest.config.ts (which runs the Workers-pool backend
// tests) - this covers plain frontend logic (markdown parsing etc.) that
// needs no Workers runtime.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ["src/**/*.test.ts"],
  },
});
