import Reconciler from "react-reconciler";
import {
  ElementType,
  DocxInstance,
  DocxContainer,
  DocumentNode,
  SectionNode,
  ParagraphNode,
  TextRunNode,
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
} from "./types";

// Create mutable tree nodes based on element type
function createMutableNode(type: ElementType, props: any): DocxInstance {
  const { children, ...nodeProps } = props;

  switch (type) {
    case "RDDocument":
      return new DocumentNode(nodeProps);

    case "RDSection":
      return new SectionNode(nodeProps);

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

    default:
      throw new Error(`Unknown element type: ${type}`);
  }
}

export const DocxReconciler = Reconciler({
  createInstance(type: ElementType, props: any): DocxInstance {
    return createMutableNode(type, props);
  },

  createTextInstance(text: string): DocxInstance {
    return new TextRunNode({ text });
  },

  appendChild(parent: MutableNode, child: MutableNode): void {
    parent.children.push(child);
  },

  appendInitialChild(parent: MutableNode, child: MutableNode): void {
    parent.children.push(child);
  },

  appendChildToContainer(container: DocxContainer, child: MutableNode): void {
    if (child instanceof DocumentNode) {
      container.rootInstance = child;
    }
  },

  insertBefore(
    parent: MutableNode,
    child: MutableNode,
    beforeChild: MutableNode
  ): void {
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

  commitTextUpdate(
    textInstance: TextRunNode,
    oldText: string,
    newText: string
  ): void {
    textInstance.props.text = newText;
  },

  commitUpdate(
    instance: MutableNode,
    updatePayload: any,
    type: string,
    oldProps: any,
    newProps: any
  ): void {
    // Update props on the instance
    const { children, ...nodeProps } = newProps;
    instance.props = nodeProps;
  },

  getRootHostContext(): any {
    return {};
  },

  getChildHostContext(parentHostContext: any): any {
    return parentHostContext;
  },

  shouldSetTextContent(): boolean {
    return false;
  },

  prepareUpdate(
    instance: MutableNode,
    type: string,
    oldProps: any,
    newProps: any
  ): any {
    return true;
  },

  prepareForCommit(): Record<string, any> | null {
    return null;
  },

  resetAfterCommit(): void {
    // No-op
  },

  getPublicInstance(instance: DocxInstance): DocxInstance {
    return instance;
  },

  clearContainer(container: DocxContainer): void {
    container.rootInstance = null;
  },

  finalizeInitialChildren(): boolean {
    return false;
  },

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  getCurrentUpdatePriority: () => 16,
  noTimeout: -1,

  preparePortalMount(): void {},
  getInstanceFromNode(): any {
    return null;
  },
  beforeActiveInstanceBlur(): void {},
  afterActiveInstanceBlur(): void {},
  prepareScopeUpdate(): void {},
  getInstanceFromScope(): any {
    return null;
  },
  detachDeletedInstance(): void {},
  requestPostPaintCallback(): void {},
  maySuspendCommit(): boolean {
    return false;
  },
  preloadInstance(): boolean {
    return true;
  },
  startSuspendingCommit(): void {},
  suspendInstance(): void {},
  waitForCommitToBeReady(): null {
    return null;
  },
  NotPendingTransition: null,

  supportsMutation: true, // Use mutation mode
  supportsPersistence: false, // Not using persistence mode
  supportsHydration: false, // No SSR hydration needed
  isPrimaryRenderer: false, // Not managing a real DOM
} as any);
