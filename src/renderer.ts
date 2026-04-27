import { ReactElement } from "react";
import * as docx from "docx";
import { DocxReconciler } from "./reconciler-v19";
import { transformNodeToDocx } from "./transformers/docx-transformer";
import { DocxContainer } from "./types";
import { DocumentNode, ListNode, MutableNode } from "./nodes";
import { DEFAULT_NUMBERING } from "./constants";

function containsList(node: MutableNode): boolean {
  if (node instanceof ListNode) return true;
  for (const child of node.children) {
    if (containsList(child)) return true;
  }
  return false;
}

function ensureNumberingConfig(documentNode: DocumentNode): void {
  if (!containsList(documentNode)) return;

  const existing = documentNode.props.numbering;
  const existingConfigs: Array<{ reference: string }> = existing?.config ?? [];
  const existingRefs = new Set(existingConfigs.map((c) => c.reference));

  const defaults = DEFAULT_NUMBERING.config.filter(
    (c) => !existingRefs.has(c.reference)
  );
  if (defaults.length === 0) return;

  documentNode.props = {
    ...documentNode.props,
    numbering: {
      ...(existing ?? {}),
      config: [...existingConfigs, ...defaults],
    },
  };
}

export const renderToDocx = async (element: ReactElement) => {
  const container: DocxContainer = { rootInstance: null };

  const fiberRoot = DocxReconciler.createContainer(
    container,
    0,
    null,
    false,
    null,
    "",
    () => {},
    null
  );

  DocxReconciler.updateContainer(element, fiberRoot, null, () => {});

  const documentNode = container.rootInstance;

  if (!documentNode || !(documentNode instanceof DocumentNode)) {
    throw new Error(
      "No Document element found at root. Make sure your JSX starts with <Document>."
    );
  }

  ensureNumberingConfig(documentNode);

  const docxDocument = transformNodeToDocx(documentNode);

  if (!docxDocument || !(docxDocument instanceof docx.Document)) {
    throw new Error("Failed to transform mutable tree to DOCX document");
  }

  return docxDocument;
};

export const renderToBuffer = async (tree: ReactElement) => {
  const document = await renderToDocx(tree);
  const buffer = await docx.Packer.toBuffer(document);
  return buffer;
};

export const renderToBlob = async (tree: ReactElement): Promise<Blob> => {
  const document = await renderToDocx(tree);
  const blob = await docx.Packer.toBlob(document);
  return blob;
};

export const renderToBase64 = async (
  element: ReactElement
): Promise<string> => {
  const buffer = await renderToBuffer(element);
  return buffer.toString("base64");
};

export const render = renderToBuffer;
