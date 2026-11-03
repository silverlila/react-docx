import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", reader: "src/read/index.ts", codegen: "src/codegen/index.ts", html: "src/html/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "docx", "fflate", "htmlparser2", "domhandler"],
  target: "node16",
  noExternal: [],
});
