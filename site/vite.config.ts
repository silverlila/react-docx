/** docx.js alone is about 1 MB minified, and the examples need it to write .docx files in the browser,
 *  so the chunk-size warning limit is raised. */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: process.env.SITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@react-docx\/core$/, replacement: here("../src/index.ts") },
      { find: /^@react-docx\/core\/reader$/, replacement: here("../src/read/index.ts") },
      { find: /^@react-docx\/core\/codegen$/, replacement: here("../src/codegen/index.ts") },
      { find: /^@react-docx\/core\/html$/, replacement: here("../src/html/index.ts") },
    ],
    dedupe: ["react", "react-dom", "docx"],
  },
  server: { fs: { allow: [here("..")] } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { home: here("index.html"), preview: here("preview/index.html"), docs: here("docs/index.html") },
    },
  },
});
