import React, { type ReactNode } from "react";
import type {
  BookmarkProps,
  BreakProps,
  DocumentProps,
  ExternalHyperlinkProps,
  FooterProps,
  HeaderProps,
  ImageRunProps,
  InternalHyperlinkProps,
  ListItemProps,
  ListProps,
  MathProps,
  MathRunProps,
  PageBreakProps,
  ParagraphProps,
  SectionProps,
  SymbolRunProps,
  TabProps,
  TableCellProps,
  TableProps,
  TableRowProps,
  TextRunProps,
} from "./types";

/** A component rendering the `RD<kind>` host element. Each export below is created once, at module
 *  level: callers match components by identity (`el.type === Table`). */
function element<P extends { children?: ReactNode }>(kind: string): React.FC<P> {
  const Component: React.FC<P> = ({ children, ...props }) => React.createElement(`RD${kind}`, props, children);
  Component.displayName = kind;
  return Component;
}

export const Document = element<DocumentProps>("Document");
export const Section = element<SectionProps>("Section");
export const Header = element<HeaderProps>("Header");
export const Footer = element<FooterProps>("Footer");
export const Paragraph = element<ParagraphProps>("Paragraph");
export const TextRun = element<TextRunProps>("TextRun");
export const Table = element<TableProps>("Table");
export const TableRow = element<TableRowProps>("TableRow");
export const TableCell = element<TableCellProps>("TableCell");
export const Tab = element<TabProps>("Tab");
export const ImageRun = element<ImageRunProps>("ImageRun");
export const ExternalHyperlink = element<ExternalHyperlinkProps>("ExternalHyperlink");
export const InternalHyperlink = element<InternalHyperlinkProps>("InternalHyperlink");
export const PageBreak = element<PageBreakProps>("PageBreak");
export const Bookmark = element<BookmarkProps>("Bookmark");
export const SymbolRun = element<SymbolRunProps>("SymbolRun");
export const Math = element<MathProps>("Math");
export const MathRun = element<MathRunProps>("MathRun");
export const Break = element<BreakProps>("Break");
export const List = element<ListProps>("List");
export const ListItem = element<ListItemProps>("ListItem");
