/** `@react-docx/core/reader`: readDocx turns a .docx into a canonical document tree plus diagnostics.
 *
 *  - Synchronous and browser-safe: no Buffer, no fs, no docx.js at runtime.
 *  - The reader builds author nodes and canonicalize owns every canonical rule (decision 3). A TreeError
 *    from canonicalize means the reader built a tree it should not have, so it is rethrown as a reader
 *    bug. NotADocxError is thrown only for bytes that are not a Word package. */

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
