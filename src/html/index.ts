/** `@react-docx/core/html`: DocxPreview draws a canonical document tree as HTML, from authored JSX
 *  (through renderToTree) or from a read .docx alike.
 *
 *  Browser-safe: no docx.js and no fflate at runtime. htmlparser2 is bundled for the raw styles a read
 *  document keeps. */

export { DocxPreview, type DocxPreviewProps } from "./preview";
export type { ResolvedBlock, ResolvedInline } from "./model";
export { resolveDocument, type ResolvedPage, type ResolvedPart } from "./pages";
export { renderToTree } from "../tree/render";
export type { DocumentNode } from "../schema/elements";
