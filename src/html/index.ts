/** `@react-docx/core/html`: DocxPreview draws a canonical document tree as HTML, from authored JSX
 *  (through renderToTree) or from a read .docx alike.
 *
 *  Browser-safe: no docx.js and no fflate at runtime. htmlparser2 is bundled for the raw styles a read
 *  document keeps. */

export { DocxPreview, type DocxPreviewProps } from "./preview";
export { resolveDocument, type ResolvedSection, type ResolvedBlock, type ResolvedInline } from "./resolve";
export { renderToTree } from "../tree/render";
export type { DocumentNode } from "../schema/elements";
