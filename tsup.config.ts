import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", reader: "src/read/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "docx", "fflate", "htmlparser2", "domhandler"],
  target: "node16",
  noExternal: [],
});
