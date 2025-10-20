/** NOT Ready, WORK IN PROGRESS */

import {
  MutableNode,
  DocumentNode,
  SectionNode,
  ParagraphNode,
  TextRunNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  BreakNode,
  TabNode,
} from "../nodes";

class StyleConverter {
  static sizeToPt(size?: number): string | null {
    if (!size) return null;
    return `${size / 2}pt`;
  }

  static color(color?: string): string | null {
    if (!color) return null;
    return `#${color}`;
  }

  static twipsToPt(twips?: number): string | null {
    if (twips === undefined || twips === null) return null;
    return `${twips / 20}pt`;
  }

  static alignment(alignment?: string): string | null {
    if (!alignment) return null;
    const alignmentMap: Record<string, string> = {
      center: "center",
      left: "left",
      right: "right",
      justified: "justify",
      both: "justify",
    };
    return alignmentMap[alignment.toLowerCase()] || null;
  }

  static textRunStyles(props: any): string {
    const styles: string[] = [];

    const font = props.font || "Calibri";
    styles.push(`font-family: '${font}'`);

    const fontSize = this.sizeToPt(props.size) || "11pt"; // Default 11pt
    styles.push(`font-size: ${fontSize}`);

    const color = this.color(props.color) || "#000000"; // Default black
    styles.push(`color: ${color}`);

    // Conditional styles
    if (props.bold) styles.push("font-weight: bold");
    if (props.italics) styles.push("font-style: italic");
    if (props.underline) styles.push("text-decoration: underline");
    if (props.strike) styles.push("text-decoration: line-through");

    if (props.allCaps) styles.push("text-transform: uppercase");
    if (props.smallCaps) styles.push("font-variant: small-caps");

    return styles.join("; ");
  }

  static paragraphStyles(props: any): string {
    const styles: string[] = [];

    const alignment = this.alignment(props.alignment);
    if (alignment) styles.push(`text-align: ${alignment}`);

    // Handle spacing
    if (props.spacing) {
      const before = this.twipsToPt(props.spacing.before);
      const after = this.twipsToPt(props.spacing.after);
      const line = props.spacing.line;

      if (before) styles.push(`margin-top: ${before}`);
      if (after) styles.push(`margin-bottom: ${after}`);
      if (line) styles.push(`line-height: ${line / 240}`);
    }

    if (props.indent) {
      const left = this.twipsToPt(props.indent.left);
      const right = this.twipsToPt(props.indent.right);
      const firstLine = this.twipsToPt(props.indent.firstLine);

      if (left) styles.push(`margin-left: ${left}`);
      if (right) styles.push(`margin-right: ${right}`);
      if (firstLine) styles.push(`text-indent: ${firstLine}`);
    }

    if (props.border) {
      const borderStyles = props.border;
      if (borderStyles.left)
        styles.push(`border-left: 1px solid #${borderStyles.left.color}`);
      if (borderStyles.right)
        styles.push(`border-right: 1px solid #${borderStyles.right.color}`);
      if (borderStyles.top)
        styles.push(`border-top: 1px solid #${borderStyles.top.color}`);
      if (borderStyles.bottom)
        styles.push(`border-bottom: 1px solid #${borderStyles.bottom.color}`);
    }

    return styles.join("; ");
  }
}

/**
 * Transform a mutable node tree to HTML string
 */
export function transformNodeToHtml(node: MutableNode): string {
  switch (node.nodeType) {
    case "Document":
      return transformDocument(node as DocumentNode);
    case "Section":
      return transformSection(node as SectionNode);
    case "Paragraph":
      return transformParagraph(node as ParagraphNode);
    case "TextRun":
      return transformTextRun(node as TextRunNode);
    case "Table":
      return transformTable(node as TableNode);
    case "TableRow":
      return transformTableRow(node as TableRowNode);
    case "TableCell":
      return transformTableCell(node as TableCellNode);
    case "Break":
      return transformBreak(node as BreakNode);
    case "Tab":
      return transformTab(node as TabNode);
    default:
      console.warn(`Unhandled node type: ${node.nodeType}`);
      return "";
  }
}

function transformDocument(node: DocumentNode): string {
  const childrenHtml = node.children.map(transformNodeToHtml).join("");

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document Preview</title>
      <style>
        /* CSS Reset - only normalize, don't style */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        /* Body - just layout, no text styling */
        body {
          background-color: #525659;
          padding: 20px;
        }

        /* Document container - layout only */
        .document {
          max-width: 850px;
          margin: 0 auto;
        }

        /* Section - represents a page */
        .section {
          background: white;
          padding: 96px; /* 1 inch margins */
          min-height: 1056px; /* ~11 inches at 96 DPI */
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          margin-bottom: 20px;
        }

        /* Paragraphs - NO default styles, let DOCX props control everything */
        p {
          /* Only reset margin, let styles come from inline styles */
          margin: 0;
        }

        /* Tables - basic structure only */
        table {
          border-collapse: collapse;
          width: 100%;
        }

        table td,
        table th {
          border: 1px solid #000;
          padding: 4pt 8pt;
        }

        /* Preview badge */
        .preview-badge {
          text-align: center;
          padding: 10px;
          background: #323639;
          color: white;
          border-radius: 4px;
          margin-bottom: 20px;
          font-size: 12px;
        }

        .preview-badge .live {
          background: #0078d4;
          padding: 4px 10px;
          border-radius: 3px;
          font-weight: 600;
          margin-right: 10px;
        }
      </style>
    </head>
    <body>
      <div class="document">
        <div class="preview-badge">
          <span class="live">LIVE PREVIEW</span>
          <span>Rendered with react-docx formatting • Auto-updates on save</span>
        </div>
        ${childrenHtml}
      </div>
    </body>
    </html>
  `;
}

function transformSection(node: SectionNode): string {
  const childrenHtml = node.children.map(transformNodeToHtml).join("");
  return `<div class="section">${childrenHtml}</div>`;
}

function transformParagraph(node: ParagraphNode): string {
  const style = StyleConverter.paragraphStyles(node.props);
  const styleAttr = style ? ` style="${style}"` : "";
  const childrenHtml = node.children.map(transformNodeToHtml).join("");

  return `<p${styleAttr}>${childrenHtml}</p>`;
}

function transformTextRun(node: TextRunNode): string {
  const style = StyleConverter.textRunStyles(node.props);
  const text = escapeHtml(node.props.text || "");

  // Debug: log what we're generating
  console.log("TextRun:", {
    text: node.props.text?.substring(0, 20),
    props: node.props,
    style,
  });

  // Always wrap in span now since we always have styles (defaults)
  return `<span style="${style}">${text}</span>`;
}

function transformTable(node: TableNode): string {
  const childrenHtml = node.children.map(transformNodeToHtml).join("");
  return `<table>${childrenHtml}</table>`;
}

function transformTableRow(node: TableRowNode): string {
  const childrenHtml = node.children.map(transformNodeToHtml).join("");
  return `<tr>${childrenHtml}</tr>`;
}

function transformTableCell(node: TableCellNode): string {
  const childrenHtml = node.children.map(transformNodeToHtml).join("");
  return `<td>${childrenHtml}</td>`;
}

function transformBreak(node: BreakNode): string {
  return "<br>";
}

function transformTab(node: TabNode): string {
  return "&nbsp;&nbsp;&nbsp;&nbsp;"; // 4 spaces for a tab
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**


export const renderToHtml = (element: ReactElement): string => {
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

  // Transform the mutable tree to HTML
  const html = transformNodeToHtml(documentNode);

  return html;
};
 */
