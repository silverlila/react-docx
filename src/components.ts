import React, { type ReactNode } from "react";
import type {
  BookmarkProps,
  BreakProps,
  CarriageReturnProps,
  CheckBoxProps,
  ColumnBreakProps,
  CommentProps,
  CommentRangeEndProps,
  CommentRangeStartProps,
  CommentReferenceProps,
  DayLongProps,
  DayShortProps,
  DeletedTextRunProps,
  DocumentProps,
  ExternalHyperlinkProps,
  FooterProps,
  FootnoteProps,
  HeaderProps,
  ImageRunProps,
  InsertedTextRunProps,
  InternalHyperlinkProps,
  ListItemProps,
  ListProps,
  MathProps,
  MathRunProps,
  MonthLongProps,
  MonthShortProps,
  NoBreakHyphenProps,
  PageBreakProps,
  PageReferenceProps,
  ParagraphProps,
  PositionalTabProps,
  RawXmlProps,
  SectionProps,
  SequentialIdentifierProps,
  SimpleFieldProps,
  SimpleMailMergeFieldProps,
  SoftHyphenProps,
  SymbolRunProps,
  TableCellProps,
  TableOfContentsProps,
  TableProps,
  TableRowProps,
  TabProps,
  TextboxProps,
  TextRunProps,
  YearLongProps,
  YearShortProps,
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
export const RawXml = element<RawXmlProps>("RawXml");
export const Footnote = element<FootnoteProps>("Footnote");
/** A comment, as a child of Document; `CommentRangeStart`, `CommentRangeEnd` and `CommentReference` with its
 *  `id` mark where it applies. docx.js exports a `Comment` class too: alias one when importing both. */
export const Comment = element<CommentProps>("Comment");
export const CommentRangeStart = element<CommentRangeStartProps>("CommentRangeStart");
export const CommentRangeEnd = element<CommentRangeEndProps>("CommentRangeEnd");
export const CommentReference = element<CommentReferenceProps>("CommentReference");
export const TableOfContents = element<TableOfContentsProps>("TableOfContents");
export const Textbox = element<TextboxProps>("Textbox");
export const InsertedTextRun = element<InsertedTextRunProps>("InsertedTextRun");
export const DeletedTextRun = element<DeletedTextRunProps>("DeletedTextRun");
export const ColumnBreak = element<ColumnBreakProps>("ColumnBreak");
export const SimpleField = element<SimpleFieldProps>("SimpleField");
export const SimpleMailMergeField = element<SimpleMailMergeFieldProps>("SimpleMailMergeField");
export const SequentialIdentifier = element<SequentialIdentifierProps>("SequentialIdentifier");
export const PageReference = element<PageReferenceProps>("PageReference");
export const CheckBox = element<CheckBoxProps>("CheckBox");
export const PositionalTab = element<PositionalTabProps>("PositionalTab");
export const CarriageReturn = element<CarriageReturnProps>("CarriageReturn");
export const SoftHyphen = element<SoftHyphenProps>("SoftHyphen");
export const NoBreakHyphen = element<NoBreakHyphenProps>("NoBreakHyphen");
export const DayShort = element<DayShortProps>("DayShort");
export const DayLong = element<DayLongProps>("DayLong");
export const MonthShort = element<MonthShortProps>("MonthShort");
export const MonthLong = element<MonthLongProps>("MonthLong");
export const YearShort = element<YearShortProps>("YearShort");
export const YearLong = element<YearLongProps>("YearLong");
