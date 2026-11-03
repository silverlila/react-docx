import { isValidElement, type ReactElement } from "react";
import * as docx from "docx";
import type { DocumentNode } from "../schema/elements";
import { canonicalize } from "../tree/canonical";
import { renderToTree } from "../tree/render";
import { buildDocument } from "./build";

/** JSX, or a canonical tree such as `renderToTree` returns. */
export type RenderSource = ReactElement | DocumentNode;

function isTree(source: RenderSource): source is DocumentNode {
  return !isValidElement(source);
}

/** A tree is canonicalized again: it is idempotent, and a hand-built tree is normalized or rejected like JSX. */
function toDocument(source: RenderSource): docx.Document {
  const tree = isTree(source) ? canonicalize(source) : renderToTree(source);
  return buildDocument(tree);
}

export async function renderToBuffer(source: RenderSource): Promise<Buffer> {
  return docx.Packer.toBuffer(toDocument(source));
}

export async function renderToBlob(source: RenderSource): Promise<Blob> {
  return docx.Packer.toBlob(toDocument(source));
}

/** Uses docx.js's own base64 output, not Node's Buffer, so it works in browsers. */
export async function renderToBase64(source: RenderSource): Promise<string> {
  return docx.Packer.toBase64String(toDocument(source));
}
