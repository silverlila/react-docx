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
} from "./types";

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
  }

  throw new Error(`Unknown node type: ${node.nodeType}`);
}

function transformDocument(node: DocumentNode): docx.Document {
  // Transform all children (should be Section nodes)
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
  // Transform all children (should be paragraphs, tables, etc.)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return {
    ...node.props,
    children: children,
  };
}

function transformParagraph(node: ParagraphNode): docx.Paragraph {
  // Transform all children (should be TextRuns)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Paragraph({
    children: children,
    ...node.props,
  });
}

function transformTextRun(node: TextRunNode): docx.TextRun {
  // TextRun doesn't have children, just props
  return new docx.TextRun(node.props);
}

function transformTable(node: TableNode): docx.Table {
  // Transform all children (should be TableRows)
  const rows = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Table({
    rows: rows,
    ...node.props,
  });
}

function transformTableRow(node: TableRowNode): docx.TableRow {
  // Transform all children (should be TableCells)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.TableRow({
    children: children,
    ...node.props,
  });
}

function transformTableCell(node: TableCellNode): docx.TableCell {
  // Transform all children (should be Paragraphs)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.TableCell({
    children: children,
    ...node.props,
  });
}

function transformTab(node: TabNode): docx.Tab {
  return new docx.Tab();
}

function transformImageRun(node: ImageRunNode): docx.ImageRun {
  return new docx.ImageRun(node.props);
}

function transformExternalHyperlink(
  node: ExternalHyperlinkNode
): docx.ExternalHyperlink {
  // Transform children (should be TextRuns or other inline elements)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.ExternalHyperlink({
    link: node.props.link,
    children: children,
  });
}

function transformInternalHyperlink(
  node: InternalHyperlinkNode
): docx.InternalHyperlink {
  // Transform children (should be TextRuns or other inline elements)
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
  // Transform children
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Bookmark({
    id: node.props.id,
    children: children,
  });
}

function transformSymbolRun(node: SymbolRunNode): docx.SymbolRun {
  // Create symbol run
  return new docx.SymbolRun(node.props.char);
}

function transformMath(node: MathNode): docx.Math {
  // Transform children (should be math elements)
  const children = node.children.map((child) => transformNodeToDocx(child));

  return new docx.Math({
    children: children,
  });
}

function transformBreak(_node: BreakNode): docx.TextRun {
  // Line break within a paragraph
  // In DOCX, this is done using a TextRun with the break property
  return new docx.TextRun({
    break: 1,
  });
}
