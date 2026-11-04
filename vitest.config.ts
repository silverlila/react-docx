import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [{ find: /^@react-docx\/core$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }],
  },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
