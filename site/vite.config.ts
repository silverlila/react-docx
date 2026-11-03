import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The site runs on the library's source, so every page shows the code as it is in this repo, with no build step.
// Three HTML entries, one per page: plain links between them, and no client router.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@react-docx\/core$/, replacement: here("../src/index.ts") },
      { find: /^@react-docx\/core\/reader$/, replacement: here("../src/read/index.ts") },
      { find: /^@react-docx\/core\/codegen$/, replacement: here("../src/codegen/index.ts") },
      { find: /^@react-docx\/core\/html$/, replacement: here("../src/html/index.ts") },
    ],
    // One copy of each: react so hooks and the reconciler share state, and docx so the site writes with the
    // same docx.js version the library is tested against (its own package.json pins that version).
    dedupe: ["react", "react-dom", "docx"],
  },
  server: { fs: { allow: [here("..")] } },
  build: {
    // docx.js alone is about 1 MB minified, and the examples need it to write .docx files in the browser.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { home: here("index.html"), preview: here("preview/index.html"), docs: here("docs/index.html") },
    },
  },
});
