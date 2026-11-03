import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json's include is src/** only, so do not rely on it for test/*.tsx
  esbuild: { jsx: "automatic" },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
