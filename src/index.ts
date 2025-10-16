// Main exports
export { renderToBuffer, renderToBlob, renderToBase64 } from "./renderer";

// Component exports
export {
  Document,
  Section,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Tab,
  ImageRun,
  ExternalHyperlink,
  InternalHyperlink,
  PageBreak,
  Bookmark,
  SymbolRun,
  Math,
  Break,
} from "./components";

// Type exports
export type {
  DocumentProps,
  SectionProps,
  ParagraphProps,
  TextRunProps,
  TableProps,
  TableRowProps,
  TableCellProps,
  TabProps,
  ImageRunProps,
  ExternalHyperlinkProps,
  InternalHyperlinkProps,
  PageBreakProps,
  BookmarkProps,
  SymbolRunProps,
  MathProps,
  BreakProps,
} from "./types";
