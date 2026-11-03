/** pnpm run preview <file.docx | module.tsx> [out.html]
 *
 *  Writes a standalone HTML preview of a document, to `out.html` or to .preview/<name>.html, and prints
 *  its path.
 *  - A .docx is read with readDocx.
 *  - A .tsx, .jsx or .ts module is imported, and its default export (a component or an element) is
 *    rendered with renderToTree. A module printed by printJsx (e.g. .roundtrip/<name>/<Name>.tsx) imports
 *    "@react-docx/core", which resolves to dist/ through the package's self-reference: run
 *    `pnpm run build` first.
 *  previewHtml is shared with scripts/roundtrip.ts. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocxPreview, renderToTree } from "../src/html/index";
import { readDocx } from "../src/read/index";
import type { DocumentNode } from "../src/schema/elements";

const OUT = ".preview";
const MODULE_EXTENSIONS = [".tsx", ".jsx", ".ts"];

const BODY_STYLE = { margin: 0, background: "#e8e8e8", padding: "24pt 0" } as const;

/** A whole HTML page showing `tree`, titled `title`. */
export function previewHtml(tree: DocumentNode, title: string): string {
  const page = renderToStaticMarkup(
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
      </head>
      <body style={BODY_STYLE}>
        <DocxPreview document={tree} />
      </body>
    </html>
  );
  return `<!doctype html>${page}`;
}

/** Imports a module and renders its default export, a component or an element, to a tree. */
async function moduleTree(file: string): Promise<DocumentNode> {
  // tsx compiles a .tsx outside tsconfig.json's `include` (src/**/*) with the classic JSX runtime, which
  // calls a global `React`. printJsx output imports no React (it is written for the automatic runtime),
  // so the global stands in for that import.
  Object.assign(globalThis, { React });
  const mod: { default?: unknown } = await import(pathToFileURL(resolve(file)).href);
  const exported = mod.default;
  if (React.isValidElement(exported)) return renderToTree(exported);
  if (typeof exported === "function") return renderToTree(React.createElement(exported as React.ComponentType));
  throw new Error(`${file}: the default export is neither a component nor an element`);
}

async function treeOf(file: string): Promise<DocumentNode> {
  const extension = extname(file);
  if (extension === ".docx") return readDocx(new Uint8Array(readFileSync(file))).document;
  if (MODULE_EXTENSIONS.includes(extension)) return moduleTree(file);
  throw new Error(`${file}: expected a .docx file or a ${MODULE_EXTENSIONS.join("/")} module`);
}

async function main([file, out]: readonly string[]): Promise<number> {
  if (file === undefined) {
    console.error("usage: pnpm run preview <file.docx | module.tsx> [out.html]");
    return 1;
  }
  const name = basename(file, extname(file));
  const path = out ?? join(OUT, `${name}.html`);
  const html = previewHtml(await treeOf(file), name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  console.log(path);
  return 0;
}

// Run only as the script itself, not when scripts/roundtrip.ts imports previewHtml.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    }
  );
}
