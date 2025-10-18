import { ReactElement } from "react";
import * as docx from "docx";
import { DocxReconciler } from "./reconciler-v19";
import { transformNodeToDocx } from "./transformer";
import { DocxContainer, DocumentNode } from "./types";

export const renderToDocx = async (element: ReactElement) => {
  // Create a container for the reconciler
  const container: DocxContainer = { rootInstance: null };

  // Create a fiber root
  const fiberRoot = DocxReconciler.createContainer(
    container,
    0, // tag
    null, // hydrationCallbacks
    false, // isStrictMode
    null, // concurrentUpdatesByDefaultOverride
    "", // identifierPrefix
    () => {}, // onRecoverableError
    null // transitionCallbacks
  );

  DocxReconciler.updateContainer(
    element,
    fiberRoot,
    null, // parentComponent
    () => {} // onComplete callback
  );

  // Extract the mutable document tree from our container
  const documentNode = container.rootInstance;

  if (!documentNode || !(documentNode instanceof DocumentNode)) {
    throw new Error(
      "No Document element found at root. Make sure your JSX starts with <Document>."
    );
  }

  // Transform the mutable tree to DOCX objects
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
