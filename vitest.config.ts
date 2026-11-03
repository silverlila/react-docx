import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Modules printed by printJsx import "@react-docx/core"; under test that is the source, not dist/.
  resolve: { alias: [{ find: /^@react-docx\/core$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }] },
  test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
