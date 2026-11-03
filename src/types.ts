import type { ReactNode } from "react";
import type * as docx from "docx";
import type { StylesProps, TextboxProps as TextboxOptions } from "./schema/elements";

/** Authoring props: docx.js option types verbatim, with element children in place of option-bag children. */
type Kids = { children?: ReactNode };
type NoKids = { children?: never };
type HeaderFooterType = { type?: "default" | "first" | "even" };

/** `styles.importedStyles` takes raw `<w:style>` XML strings. */
export type DocumentProps = Omit<
  docx.IPropertiesOptions,
  "sections" | "footnotes" | "comments" | "externalStyles" | "styles"
> & { styles?: StylesProps } & Kids;
export type SectionProps = Omit<docx.ISectionOptions, "children" | "headers" | "footers"> & Kids;
export type HeaderProps = HeaderFooterType & Kids;
export type FooterProps = HeaderFooterType & Kids;
export type ParagraphProps = Omit<docx.IParagraphOptions, "children"> & Kids;
export type TextRunProps = Omit<docx.IRunOptions, "children"> & Kids;
export type TableProps = Omit<docx.ITableOptions, "rows"> & Kids;
export type TableRowProps = Omit<docx.ITableRowOptions, "children"> & Kids;
export type TableCellProps = Omit<docx.ITableCellOptions, "children"> & Kids;
export type TabProps = NoKids;
export type ImageRunProps = docx.IImageOptions & NoKids;
export type ExternalHyperlinkProps = { link: string } & Kids;
export type InternalHyperlinkProps = { anchor: string } & Kids;
export type PageBreakProps = NoKids;
export type BookmarkProps = { id: string } & Kids;
export type SymbolRunProps = docx.ISymbolRunOptions & NoKids;
/** `text` becomes a leading MathRun. */
export type MathProps = { text?: string } & Kids;
export type MathRunProps = Kids;
export type BreakProps = NoKids;
/** Nesting a List inside a List or ListItem sets the level. */
export type ListProps = { type?: "bullet" | "numbered" } & Kids;
export type ListItemProps = Omit<docx.IParagraphOptions, "children" | "numbering"> & Kids;
/** One or more sibling OOXML elements, written verbatim. Legal where a block, an inline or run content stands. */
export type RawXmlProps = { xml: string } & NoKids;
/** Stands where it is referenced, holding the footnote's content. Loose text becomes a Paragraph. */
export type FootnoteProps = Kids;
/** A Document child. Loose text becomes a Paragraph. */
export type CommentProps = Omit<docx.ICommentOptions, "children"> & Kids;
export type CommentRangeStartProps = { id: number } & NoKids;
export type CommentRangeEndProps = { id: number } & NoKids;
export type CommentReferenceProps = { id: number } & NoKids;
export type TableOfContentsProps = { alias?: string } & docx.ITableOfContentsOptions & NoKids;
/** Holds Paragraphs; loose text becomes one. `style` is the VML shape style, such as `{ width: "200pt" }`. */
export type TextboxProps = TextboxOptions & Kids;
