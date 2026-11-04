/** tsx compiles a .tsx outside tsconfig.json's `include` with the classic JSX runtime, which calls a
 *  global `React`; printJsx output imports none (it targets the automatic runtime), so a global stands in.
 *
 *  A module printed by printJsx imports "@react-docx/core", which resolves to dist/ through the package's
 *  self-reference, so run `pnpm run build` before previewing one. */

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

async function moduleTree(file: string): Promise<DocumentNode> {
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    }
  );
}
