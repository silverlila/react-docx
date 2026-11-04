import type { ReactNode } from "react";
import type * as docx from "docx";
import type { Props } from "./schema/elements";

type Kids = { children?: ReactNode };
type NoKids = { children?: never };
type HeaderFooterType = { type?: "default" | "first" | "even" };

export type DocumentProps = Props<"Document"> & Kids;
export type SectionProps = Props<"Section"> & Kids;
export type HeaderProps = HeaderFooterType & Kids;
export type FooterProps = HeaderFooterType & Kids;
export type ParagraphProps = Omit<docx.IParagraphOptions, "children"> & Kids;
export type TextRunProps = Props<"TextRun"> & Kids;
export type TableProps = Props<"Table"> & Kids;
export type TableRowProps = Props<"TableRow"> & Kids;
export type TableCellProps = Props<"TableCell"> & Kids;
export type TabProps = Props<"Tab"> & NoKids;
export type ImageRunProps = docx.IImageOptions & NoKids;
export type ExternalHyperlinkProps = Props<"ExternalHyperlink"> & Kids;
export type InternalHyperlinkProps = Props<"InternalHyperlink"> & Kids;
export type PageBreakProps = Props<"PageBreak"> & NoKids;
export type BookmarkProps = Props<"Bookmark"> & Kids;
export type SymbolRunProps = Props<"SymbolRun"> & NoKids;
/** `text` becomes a leading MathRun. */
export type MathProps = { text?: string } & Kids;
export type MathRunProps = Props<"MathRun"> & Kids;
export type BreakProps = NoKids;
/** Nesting a List inside a List or ListItem sets the level. */
export type ListProps = { type?: "bullet" | "numbered" } & Kids;
export type ListItemProps = Omit<docx.IParagraphOptions, "children" | "numbering"> & Kids;
/** One or more sibling OOXML elements, written verbatim. Legal where a block, an inline or run content stands. */
export type RawXmlProps = Props<"RawXml"> & NoKids;
/** Stands where it is referenced, holding the footnote's content. Loose text becomes a Paragraph. */
export type FootnoteProps = Props<"Footnote"> & Kids;
/** A Document child. Loose text becomes a Paragraph. */
export type CommentProps = Props<"Comment"> & Kids;
export type CommentRangeStartProps = Props<"CommentRangeStart"> & NoKids;
export type CommentRangeEndProps = Props<"CommentRangeEnd"> & NoKids;
export type CommentReferenceProps = Props<"CommentReference"> & NoKids;
export type TableOfContentsProps = Props<"TableOfContents"> & NoKids;
/** Holds Paragraphs; loose text becomes one. `style` is the VML shape style, such as `{ width: "200pt" }`. */
export type TextboxProps = Props<"Textbox"> & Kids;
/** A tracked insertion: `id`, `author` and `date` (a string) mark the change, the rest are TextRun's props. */
export type InsertedTextRunProps = Props<"InsertedTextRun"> & Kids;
/** A tracked deletion, written as `w:delText`. Props as InsertedTextRun's. */
export type DeletedTextRunProps = Props<"DeletedTextRun"> & Kids;
export type ColumnBreakProps = Props<"ColumnBreak"> & NoKids;
export type SimpleFieldProps = Props<"SimpleField"> & NoKids;
export type SimpleMailMergeFieldProps = Props<"SimpleMailMergeField"> & NoKids;
export type SequentialIdentifierProps = Props<"SequentialIdentifier"> & NoKids;
/** A `PAGEREF` field to the Bookmark with id `bookmarkId`. */
export type PageReferenceProps = Props<"PageReference"> & NoKids;
export type CheckBoxProps = Props<"CheckBox"> & NoKids;
export type PositionalTabProps = Props<"PositionalTab"> & NoKids;
export type CarriageReturnProps = Props<"CarriageReturn"> & NoKids;
export type SoftHyphenProps = Props<"SoftHyphen"> & NoKids;
export type NoBreakHyphenProps = Props<"NoBreakHyphen"> & NoKids;
export type DayShortProps = Props<"DayShort"> & NoKids;
export type DayLongProps = Props<"DayLong"> & NoKids;
export type MonthShortProps = Props<"MonthShort"> & NoKids;
export type MonthLongProps = Props<"MonthLong"> & NoKids;
export type YearShortProps = Props<"YearShort"> & NoKids;
export type YearLongProps = Props<"YearLong"> & NoKids;
