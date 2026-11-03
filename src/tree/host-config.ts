import React from "react";
import { TreeError } from "./author";

/** What the reconciler builds. Mutable, internal, never exported from the package. */
export type HostNode = { type: string; props: Record<string, unknown>; children: HostChild[] };
type HostText = { type: "#text"; text: string };
export type HostChild = HostNode | HostText;
export type HostContainer = { rootInstance: HostChild | null };

type HostProps = Record<string, unknown>;

/** Props without `children`, as host instances store them. */
function ownProps(props: HostProps): HostProps {
  const { children, ...nodeProps } = props;
  return nodeProps;
}

/** The position of `child` in `parent`; React only names children it placed there. */
function indexIn(parent: HostNode, child: HostChild): number {
  const index = parent.children.indexOf(child);
  if (index === -1) throw new Error(`react-docx host: a <${parent.type}> child React named is not in it`);
  return index;
}

/** React moves a child it already placed by appending or inserting it again: like the DOM, take it out first. */
function detached(parent: HostNode, child: HostChild): void {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
}

/** Host config members shared by react-reconciler 0.29, 0.31 and 0.33. */
const base = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,

  /** Components render `RD<Kind>` host elements; the prefix is stripped. Placement is checked by canonicalize. */
  createInstance(type: string, props: HostProps): HostNode {
    if (!type.startsWith("RD")) throw new TreeError([type], `Unknown element <${type}>`);
    return { type: type.slice(2), props: ownProps(props), children: [] };
  },

  createTextInstance(text: string): HostText {
    return { type: "#text", text };
  },

  appendInitialChild(parent: HostNode, child: HostChild): void {
    parent.children.push(child);
  },

  appendChild(parent: HostNode, child: HostChild): void {
    detached(parent, child);
    parent.children.push(child);
  },

  appendChildToContainer(container: HostContainer, child: HostChild): void {
    container.rootInstance = child;
  },

  insertBefore(parent: HostNode, child: HostChild, beforeChild: HostChild): void {
    detached(parent, child);
    parent.children.splice(indexIn(parent, beforeChild), 0, child);
  },

  removeChild(parent: HostNode, child: HostChild): void {
    parent.children.splice(indexIn(parent, child), 1);
  },

  removeChildFromContainer(container: HostContainer, child: HostChild): void {
    if (container.rootInstance === child) {
      container.rootInstance = null;
    }
  },

  clearContainer(container: HostContainer): void {
    container.rootInstance = null;
  },

  commitTextUpdate(textInstance: HostText, _oldText: string, newText: string): void {
    textInstance.text = newText;
  },

  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parentHostContext: object) => parentHostContext,
  getPublicInstance: (instance: HostChild) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getInstanceFromNode: () => null,
  detachDeletedInstance() {},
} satisfies Record<string, unknown>;

/** react-reconciler 0.29 (React 18). */
export const hostConfig18 = {
  ...base,
  prepareUpdate: () => true,
  commitUpdate(
    instance: HostNode,
    _updatePayload: unknown,
    _type: string,
    _oldProps: HostProps,
    newProps: HostProps
  ): void {
    instance.props = ownProps(newProps);
  },
  getCurrentEventPriority: () => 16, // DefaultEventPriority in 0.29
} satisfies Record<string, unknown>;

let updatePriority = 0;

/** react-reconciler 0.31 and 0.33 (React 19). */
export const hostConfig19 = {
  ...base,
  commitUpdate(instance: HostNode, _type: string, _oldProps: HostProps, newProps: HostProps): void {
    instance.props = ownProps(newProps);
  },
  setCurrentUpdatePriority: (priority: number) => {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority || 32, // DefaultEventPriority in 0.31+
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  NotPendingTransition: null,
  // Must be a context of the React the library imports (the user's); a plain object crashes 0.31+.
  HostTransitionContext: React.createContext(null),
  resetFormInstance() {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  // Read by 0.33 only.
  trackSchedulerEvent() {},
} satisfies Record<string, unknown>;
