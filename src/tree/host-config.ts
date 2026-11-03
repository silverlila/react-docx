import React from "react";
import { ElementType, DocxInstance, DocxContainer } from "../types";
import {
  DocumentNode,
  SectionNode,
  HeaderNode,
  FooterNode,
  ParagraphNode,
  TextRunNode,
  TextNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  TabNode,
  ImageRunNode,
  ExternalHyperlinkNode,
  InternalHyperlinkNode,
  PageBreakNode,
  BookmarkNode,
  SymbolRunNode,
  MathNode,
  BreakNode,
  MutableNode,
  ListItemNode,
  ListNode,
} from "../nodes";

// Create mutable tree nodes based on element type
function createMutableNode(type: ElementType, props: any): DocxInstance {
  const { children, ...nodeProps } = props;

  switch (type) {
    case "RDDocument":
      return new DocumentNode(nodeProps);

    case "RDSection":
      return new SectionNode(nodeProps);

    case "RDHeader":
      return new HeaderNode(nodeProps);

    case "RDFooter":
      return new FooterNode(nodeProps);

    case "RDParagraph":
      return new ParagraphNode(nodeProps);

    case "RDTextRun":
      return new TextRunNode(props);

    case "RDTable":
      return new TableNode(nodeProps);

    case "RDTableRow":
      return new TableRowNode(nodeProps);

    case "RDTableCell":
      return new TableCellNode(nodeProps);

    case "RDTab":
      return new TabNode(nodeProps);

    case "RDImageRun":
      return new ImageRunNode(props);

    case "RDExternalHyperlink":
      return new ExternalHyperlinkNode(nodeProps);

    case "RDInternalHyperlink":
      return new InternalHyperlinkNode(nodeProps);

    case "RDPageBreak":
      return new PageBreakNode(nodeProps);

    case "RDBookmark":
      return new BookmarkNode(nodeProps);

    case "RDSymbolRun":
      return new SymbolRunNode(props);

    case "RDMath":
      return new MathNode(nodeProps);

    case "RDBreak":
      return new BreakNode(nodeProps);

    case "RDList":
      return new ListNode(nodeProps);

    case "RDListItem":
      return new ListItemNode(nodeProps);

    default:
      throw new Error(`Unknown element type: ${type}`);
  }
}

type HostProps = Record<string, unknown>;

/** Props without `children`, as host instances store them. */
function ownProps(props: HostProps): HostProps {
  const { children, ...nodeProps } = props;
  return nodeProps;
}

/** Host config members shared by react-reconciler 0.29, 0.31 and 0.33. */
const base = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,

  createInstance(type: ElementType, props: HostProps): DocxInstance {
    return createMutableNode(type, props);
  },

  createTextInstance(text: string): DocxInstance {
    return new TextNode({ text });
  },

  appendInitialChild(parent: MutableNode, child: MutableNode): void {
    parent.children.push(child);
  },

  appendChild(parent: MutableNode, child: MutableNode): void {
    parent.children.push(child);
  },

  appendChildToContainer(container: DocxContainer, child: MutableNode): void {
    if (child instanceof DocumentNode) {
      container.rootInstance = child;
    }
  },

  insertBefore(parent: MutableNode, child: MutableNode, beforeChild: MutableNode): void {
    const index = parent.children.indexOf(beforeChild);
    if (index !== -1) {
      parent.children.splice(index, 0, child);
    }
  },

  removeChild(parent: MutableNode, child: MutableNode): void {
    const index = parent.children.indexOf(child);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
  },

  removeChildFromContainer(container: DocxContainer, child: MutableNode): void {
    if (container.rootInstance === child) {
      container.rootInstance = null;
    }
  },

  clearContainer(container: DocxContainer): void {
    container.rootInstance = null;
  },

  commitTextUpdate(textInstance: TextNode, _oldText: string, newText: string): void {
    textInstance.props.text = newText;
  },

  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parentHostContext: object) => parentHostContext,
  getPublicInstance: (instance: DocxInstance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  detachDeletedInstance() {},
} satisfies Record<string, unknown>;

/** react-reconciler 0.29 (React 18). */
export const hostConfig18 = {
  ...base,
  prepareUpdate: () => true,
  commitUpdate(
    instance: MutableNode,
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
  commitUpdate(instance: MutableNode, _type: string, _oldProps: HostProps, newProps: HostProps): void {
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
  requestPostPaintCallback() {},
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  // Read by 0.33 only.
  trackSchedulerEvent() {},
  resolveTransitionIndicator() {},
} satisfies Record<string, unknown>;
