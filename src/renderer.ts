import { ReactElement } from "react";
import * as docx from "docx";
import { DocxReconciler } from "./reconciler-v19";
import { transformNodeToDocx } from "./transformer";
import { DocxContainer, RenderFunction, DocumentNode } from "./types";

export const renderToBuffer: RenderFunction = async (
  element: ReactElement
): Promise<Buffer> => {
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

  const buffer = await docx.Packer.toBuffer(docxDocument);
  return buffer;
};

export const renderToBlob = async (element: ReactElement): Promise<Blob> => {
  const buffer = await renderToBuffer(element);
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
};

export const renderToBase64 = async (
  element: ReactElement
): Promise<string> => {
  const buffer = await renderToBuffer(element);
  return buffer.toString("base64");
};

export const render = renderToBuffer;
