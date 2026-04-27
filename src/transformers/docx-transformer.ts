import * as docx from "docx";
import {
  MutableNode,
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
  ListNode,
  ListItemNode,
} from "../nodes";

/**
 * Transforms a mutable tree node into its corresponding DOCX object
 */
export function transformNodeToDocx(node: MutableNode): any {
  if (node instanceof DocumentNode) {
    return transformDocument(node);
  } else if (node instanceof SectionNode) {
    return transformSection(node);
  } else if (node instanceof ParagraphNode) {
    return transformParagraph(node);
  } else if (node instanceof TextRunNode) {
    return transformTextRun(node);
  } else if (node instanceof TableNode) {
    return transformTable(node);
  } else if (node instanceof TableRowNode) {
    return transformTableRow(node);
  } else if (node instanceof TableCellNode) {
    return transformTableCell(node);
  } else if (node instanceof TabNode) {
    return transformTab(node);
  } else if (node instanceof ImageRunNode) {
    return transformImageRun(node);
  } else if (node instanceof ExternalHyperlinkNode) {
    return transformExternalHyperlink(node);
  } else if (node instanceof InternalHyperlinkNode) {
    return transformInternalHyperlink(node);
  } else if (node instanceof PageBreakNode) {
    return transformPageBreak(node);
  } else if (node instanceof BookmarkNode) {
    return transformBookmark(node);
  } else if (node instanceof SymbolRunNode) {
    return transformSymbolRun(node);
  } else if (node instanceof MathNode) {
    return transformMath(node);
  } else if (node instanceof BreakNode) {
    return transformBreak(node);
  } else if (node instanceof ListNode) {
    return transformList(node);
  } else if (node instanceof ListItemNode) {
    return transformListItem(node);
  }

  throw new Error(`Unknown node type: ${node.nodeType}`);
}

function flattenChildren(nodes: any[]): any[] {
  return nodes.flatMap((n) => (Array.isArray(n) ? n : [n]));
}

function transformDocument(node: DocumentNode): docx.Document {
  const sections = node.children.map((child) => {
    if (child instanceof SectionNode) {
      return transformSection(child);
    }
    throw new Error(
      `Document children must be Section nodes, got: ${child.nodeType}`
    );
  });
  return new docx.Document({
    ...node.props,
    sections: sections,
  });
}

function transformSection(node: SectionNode): docx.ISectionOptions {
  const children = flattenChildren(
    node.children.map((child) => transformNodeToDocx(child))
  );

  return {
    ...node.props,
    children,
  };
}
function transformParagraph(node: ParagraphNode): docx.Paragraph {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Paragraph({
    ...node.props,
    children: children,
  });
}

function transformTextRun(node: TextRunNode): docx.TextRun {
  if (node.children.length > 0) {
    const children = node.children.map((child) => transformNodeToDocx(child));
    return new docx.TextRun({
      ...node.props,
      children: children,
    });
  }
  return new docx.TextRun(node.props);
}

function transformTable(node: TableNode): docx.Table {
  const rows = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Table({
    ...node.props,
    rows: rows,
  });
}

function transformTableRow(node: TableRowNode): docx.TableRow {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.TableRow({
    ...node.props,
    children: children,
  });
}

function transformTableCell(node: TableCellNode): docx.TableCell {
  const children = flattenChildren(
    node.children.map((child) => transformNodeToDocx(child))
  );

  return new docx.TableCell({
    ...node.props,
    children: children,
  });
}

function transformTab(node: TabNode): docx.Tab {
  return new docx.TextRun({ text: "", children: [new docx.Tab()] });
}

function transformImageRun(node: ImageRunNode): docx.ImageRun {
  return new docx.ImageRun(node.props);
}

function transformExternalHyperlink(
  node: ExternalHyperlinkNode
): docx.ExternalHyperlink {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.ExternalHyperlink({
    link: node.props.link,
    children: children,
  });
}

function transformInternalHyperlink(
  node: InternalHyperlinkNode
): docx.InternalHyperlink {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.InternalHyperlink({
    anchor: node.props.anchor,
    children: children,
  });
}

function transformPageBreak(node: PageBreakNode): docx.PageBreak {
  return new docx.PageBreak();
}

function transformBookmark(node: BookmarkNode): docx.Bookmark {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Bookmark({
    id: node.props.id,
    children: children,
  });
}

function transformSymbolRun(node: SymbolRunNode): docx.SymbolRun {
  return new docx.SymbolRun(node.props.char);
}

function transformMath(node: MathNode): docx.Math {
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Math({
    children: children,
  });
}

function transformBreak(_node: BreakNode): docx.TextRun {
  return new docx.TextRun({
    break: 1,
  });
}

function transformList(node: ListNode): docx.Paragraph[] {
  const reference =
    node.props.type === "numbered" ? "NumberedList" : "BulletList";
  const level = node.props.level ?? 0;

  return node.children.map((child) => {
    if (!(child instanceof ListItemNode)) {
      throw new Error(
        `List children must be ListItem nodes, got: ${child.nodeType}`
      );
    }
    const itemChildren = child.children.map((c) => transformNodeToDocx(c));
    return new docx.Paragraph({
      ...child.props,
      numbering: { reference, level },
      children: itemChildren,
    });
  });
}

function transformListItem(node: ListItemNode): docx.Paragraph {
  // When a ListItem is rendered outside a List, it falls back to a plain
  // paragraph without numbering (the List transformer handles the inside case).
  const children = node.children.map((child) => transformNodeToDocx(child));
  return new docx.Paragraph({
    ...node.props,
    children: children,
  });
}
