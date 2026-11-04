/** Renders JSX synchronously with the react-reconciler build that matches the user's React, then
 *  canonicalizes the result.
 *
 *  React 18 (react-reconciler 0.29) has a legacy root (tag 0). It renders synchronously and throws
 *  render errors straight out of updateContainer.
 *
 *  React 19 has no legacy root. updateContainerSync followed by flushSyncWork renders synchronously, but
 *  render errors reach only the root's error callbacks, so the first uncaught one is rethrown afterwards. */

import React from "react";
import Reconciler29 from "react-reconciler-29";
import Reconciler31 from "react-reconciler-31";
import Reconciler33 from "react-reconciler-33";
import type { DocumentNode } from "../schema/elements";
import { TreeError, type AuthorNode } from "./author";
import { canonicalize } from "./canonical";
import { hostConfig18, hostConfig19, type HostChild, type HostContainer, type HostNode } from "./host-config";
import { ReactLine, reactLine } from "./react-line";

type Render = (element: React.ReactElement, container: HostContainer) => void;

let reconciler29: ReturnType<typeof Reconciler29> | undefined;
let reconciler31: ReturnType<typeof Reconciler31> | undefined;
let reconciler33: ReturnType<typeof Reconciler33> | undefined;

function firstError(): { record: (error: unknown) => void; rethrow: () => void } {
  let first: { readonly error: unknown } | undefined;
  return {
    record: (error) => {
      first ??= { error };
    },
    rethrow: () => {
      if (first !== undefined) throw first.error;
    },
  };
}

function logCaught(error: unknown): void {
  console.error(error);
}

function render29(element: React.ReactElement, container: HostContainer): void {
  reconciler29 ??= Reconciler29(hostConfig18);
  const errors = firstError();
  const root = reconciler29.createContainer(container, 0, null, false, null, "", errors.record, null);
  reconciler29.updateContainer(element, root, null, null);
  errors.rethrow();
}

function renderSync(
  reconciler: ReturnType<typeof Reconciler31> | ReturnType<typeof Reconciler33>,
  element: React.ReactElement,
  container: HostContainer
): void {
  const errors = firstError();
  const root = reconciler.createContainer(container, 0, null, false, null, "", errors.record, logCaught, errors.record, null);
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();
  errors.rethrow();
}

const RENDER: Record<ReactLine, Render> = {
  "29": render29,
  "31": (element, container) => renderSync((reconciler31 ??= Reconciler31(hostConfig19)), element, container),
  "33": (element, container) => renderSync((reconciler33 ??= Reconciler33(hostConfig19)), element, container),
};

function renderToHost(element: React.ReactElement): HostChild | null {
  const container: HostContainer = { rootInstance: null };
  RENDER[reactLine(React.version)](element, container);
  return container.rootInstance;
}

function toAuthor(node: HostNode): AuthorNode {
  return {
    type: node.type,
    props: node.props,
    children: node.children.map((child) => ("text" in child ? child.text : toAuthor(child))),
  };
}

/** JSX → canonical tree. Synchronous. Throws the render error, or TreeError. */
export function renderToTree(element: React.ReactElement): DocumentNode {
  const root = renderToHost(element);
  if (root === null) throw new TreeError([], "Nothing rendered; the root must be <Document>");
  if ("text" in root) throw new TreeError([], "Text rendered at the root; the root must be <Document>");
  return canonicalize(toAuthor(root));
}
