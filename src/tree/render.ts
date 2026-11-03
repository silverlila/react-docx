import React from "react";
import Reconciler29 from "react-reconciler-29";
import Reconciler31 from "react-reconciler-31";
import Reconciler33 from "react-reconciler-33";
import { DocumentNode } from "../nodes";
import { DocxContainer } from "../types";
import { hostConfig18, hostConfig19 } from "./host-config";
import { ReactLine, reactLine } from "./react-line";

type Render = (element: React.ReactElement, container: DocxContainer) => void;

let reconciler29: ReturnType<typeof Reconciler29> | undefined;
let reconciler31: ReturnType<typeof Reconciler31> | undefined;
let reconciler33: ReturnType<typeof Reconciler33> | undefined;

/** React 18: a legacy root (tag 0) renders synchronously and throws render errors directly. */
function render29(element: React.ReactElement, container: DocxContainer): void {
  reconciler29 ??= Reconciler29(hostConfig18);
  let error: unknown = undefined;
  const record = (e: unknown) => {
    if (error === undefined) error = e;
  };
  const root = reconciler29.createContainer(container, 0, null, false, null, "", record, null);
  reconciler29.updateContainer(element, root, null, null);
  if (error !== undefined) throw error;
}

/** React 19 has no legacy root: render synchronously, then rethrow the first error React reported. */
function renderSync(
  reconciler: ReturnType<typeof Reconciler31> | ReturnType<typeof Reconciler33>,
  element: React.ReactElement,
  container: DocxContainer
): void {
  let error: unknown = undefined;
  const record = (e: unknown) => {
    if (error === undefined) error = e;
  };
  const root = reconciler.createContainer(container, 0, null, false, null, "", record, record, record, null);
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();
  if (error !== undefined) throw error;
}

const RENDER: Record<ReactLine, Render> = {
  "29": render29,
  "31": (element, container) => renderSync((reconciler31 ??= Reconciler31(hostConfig19)), element, container),
  "33": (element, container) => renderSync((reconciler33 ??= Reconciler33(hostConfig19)), element, container),
};

/** Renders synchronously and returns the root host instance (the DocumentNode), or throws the render error. */
export function renderToHost(element: React.ReactElement): DocumentNode | null {
  const container: DocxContainer = { rootInstance: null };
  RENDER[reactLine(React.version)](element, container);
  return container.rootInstance;
}
