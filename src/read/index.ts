import type { DocumentNode } from "../schema/elements";
import { TreeError } from "../tree/author";
import { canonicalize } from "../tree/canonical";
import { createReadSession } from "./context";
import type { Diagnostic } from "./diagnostics";
import { readDocumentNode } from "./document";
import { openPackage } from "./package";

export type ReadResult = { readonly document: DocumentNode; readonly diagnostics: readonly Diagnostic[] };

export { NotADocxError } from "./package";
export type { Diagnostic, TreePath } from "./diagnostics";

/** Synchronous and browser-safe: no Buffer, no fs, no docx.js. Throws NotADocxError only for bytes that
 *  are not a Word package. */
export function readDocx(bytes: Uint8Array | ArrayBuffer): ReadResult {
  const pkg = openPackage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const { ctx, diagnostics, consumed } = createReadSession(pkg);
  const root = readDocumentNode(ctx, consumed);
  try {
    return { document: canonicalize(root), diagnostics: diagnostics.list() };
  } catch (error) {
    if (!(error instanceof TreeError)) throw error;
    throw Object.assign(new Error(`readDocx produced an invalid tree (a reader bug): ${error.message}`), { cause: error });
  }
}
