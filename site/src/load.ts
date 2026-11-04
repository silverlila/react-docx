import type { ReactElement } from "react";
import { ELEMENTS, renderToBlob, type DocumentNode } from "@react-docx/core";
import { readDocx, NotADocxError, type Diagnostic } from "@react-docx/core/reader";
import { printJsx, type GeneratedModule } from "@react-docx/core/codegen";
import { zipSync } from "fflate";

export type LoadedFile = {
  readonly name: string;
  readonly size: number;
  readonly document: DocumentNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly componentName: string;
  readonly module: GeneratedModule;
  readonly readMs: number;
};

const TAKEN_NAMES: ReadonlySet<string> = new Set([...Object.keys(ELEMENTS), "Date", "URL"]);

export function componentName(fileName: string): string {
  const pascal = fileName
    .replace(/\.docx$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return /^[A-Za-z]/.test(pascal) && !TAKEN_NAMES.has(pascal) ? pascal : `Doc${pascal}`;
}

export class LoadError extends Error {}

export function loadDocx(name: string, bytes: Uint8Array): LoadedFile {
  const started = performance.now();
  let result;
  try {
    result = readDocx(bytes);
  } catch (error) {
    if (error instanceof NotADocxError) {
      throw new LoadError("This file is not a Word document. Choose a .docx file saved by Word 2007 or later.");
    }
    throw error;
  }
  const readMs = performance.now() - started;
  const component = componentName(name);
  return {
    name,
    size: bytes.byteLength,
    document: result.document,
    diagnostics: result.diagnostics,
    componentName: component,
    module: printJsx(result.document, { componentName: component }),
    readMs,
  };
}

export async function sampleBytes(element: ReactElement): Promise<Uint8Array> {
  return new Uint8Array(await (await renderToBlob(element)).arrayBuffer());
}

export function moduleDownload(file: LoadedFile): { blob: Blob; name: string } {
  const tsx = `${file.componentName}.tsx`;
  if (file.module.assets.length === 0) {
    return { blob: new Blob([file.module.source], { type: "text/plain" }), name: tsx };
  }
  const entries: Record<string, Uint8Array> = { [tsx]: new TextEncoder().encode(file.module.source) };
  for (const asset of file.module.assets) entries[asset.path] = asset.bytes;
  return { blob: new Blob([zipSync(entries)], { type: "application/zip" }), name: `${file.componentName}.zip` };
}

export async function rewrittenDocx(file: LoadedFile): Promise<{ blob: Blob; name: string }> {
  return { blob: await renderToBlob(file.document), name: file.name.replace(/(\.docx)?$/i, ".rewritten.docx") };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
