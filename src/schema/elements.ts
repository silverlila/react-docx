/** The element table: one row per kind, naming the docx.js class it builds, the child kinds it may hold
 *  and its content model.
 *
 *  `spec<P>()` is curried because TypeScript cannot infer some type arguments while others are given,
 *  and each row must keep its literal types.
 *
 *  docx.js facts the table encodes:
 *  - Textbox accepts a `text` option and ignores it.
 *  - Textbox children are typed as inline content but written into `<w:txbxContent>`, which holds
 *    paragraphs, so a Textbox holds Paragraphs.
 *  - The tracked-change run option types are not exported, and InsertedTextRun and DeletedTextRun take
 *    `date` as a string.
 *  - Footnote references are written only from body content, so a Footnote inside a Header, Footer,
 *    Comment or Footnote (OUTSIDE_BODY) would never be written. */

import type * as docx from "docx";

type Spec<P> = {
  readonly docx: string | null;
  readonly children: readonly string[];
  readonly content: Content;
  readonly props?: P;
};

export type Content = "block" | "wrapped" | "inline" | "run" | "math" | "literal" | "plain";

const spec =
  <P>() =>
  <const S extends Omit<Spec<P>, "props">>(row: S): S & { readonly props?: P } =>
    row;

const BLOCK = ["Paragraph", "Table", "RawXml"] as const;
const INLINE = [
  "TextRun",
  "ImageRun",
  "SymbolRun",
  "ExternalHyperlink",
  "InternalHyperlink",
  "Bookmark",
  "PageBreak",
  "Math",
  "RawXml",
  "Footnote",
  "CommentRangeStart",
  "CommentRangeEnd",
  "InsertedTextRun",
  "DeletedTextRun",
  "ColumnBreak",
  "SimpleField",
  "SimpleMailMergeField",
  "SequentialIdentifier",
  "PageReference",
  "CheckBox",
] as const;
const RUN_CONTENT = [
  "Tab",
  "PageNumber",
  "RawXml",
  "CommentReference",
  "PositionalTab",
  "CarriageReturn",
  "SoftHyphen",
  "NoBreakHyphen",
  "DayShort",
  "DayLong",
  "MonthShort",
  "MonthLong",
  "YearShort",
  "YearLong",
] as const;

export type StylesProps = Omit<docx.IStylesOptions, "importedStyles" | "initialStyles"> & {
  /** Raw <w:style> elements, as XML strings, written after docx.js's own styles. */
  readonly importedStyles?: readonly string[];
};
type DocumentProps = Omit<
  docx.IPropertiesOptions,
  "sections" | "footnotes" | "comments" | "externalStyles" | "styles"
> & { readonly styles?: StylesProps };
type RasterImage = { readonly type: "jpg" | "png" | "gif" | "bmp"; readonly data: Uint8Array };
export type ImageProps = Omit<docx.IImageOptions, "type" | "data" | "fallback"> &
  (RasterImage | { readonly type: "svg"; readonly data: Uint8Array; readonly fallback: RasterImage });
type HeaderFooterProps = { readonly type: "default" | "first" | "even" };
type TextboxOptions = ConstructorParameters<typeof docx.Textbox>[0];
type TextboxProps = Omit<TextboxOptions, "children" | "text">;
type CommentIdProps = { readonly id: number };
type InsertedTextRunProps = Omit<ConstructorParameters<typeof docx.InsertedTextRun>[0], "children">;
type DeletedTextRunProps = Omit<ConstructorParameters<typeof docx.DeletedTextRun>[0], "children">;

export const ELEMENTS = {
  Document: spec<DocumentProps>()({
    docx: "Document",
    children: ["Section", "Comment"],
    content: "plain",
  }),
  Section: spec<Omit<docx.ISectionOptions, "children" | "headers" | "footers">>()({
    docx: null,
    children: ["Header", "Footer", ...BLOCK, "TableOfContents", "Textbox"],
    content: "block",
  }),
  Header: spec<HeaderFooterProps>()({ docx: "Header", children: BLOCK, content: "block" }),
  Footer: spec<HeaderFooterProps>()({ docx: "Footer", children: BLOCK, content: "block" }),
  Paragraph: spec<Omit<docx.IParagraphOptions, "children" | "text" | "heading">>()({
    docx: "Paragraph",
    children: INLINE,
    content: "inline",
  }),
  TextRun: spec<Omit<docx.IRunOptions, "children">>()({
    docx: "TextRun",
    children: RUN_CONTENT,
    content: "run",
  }),
  Table: spec<Omit<docx.ITableOptions, "rows">>()({
    docx: "Table",
    children: ["TableRow"],
    content: "plain",
  }),
  TableRow: spec<Omit<docx.ITableRowOptions, "children">>()({
    docx: "TableRow",
    children: ["TableCell"],
    content: "plain",
  }),
  TableCell: spec<Omit<docx.ITableCellOptions, "children">>()({
    docx: "TableCell",
    children: BLOCK,
    content: "block",
  }),
  Tab: spec<{}>()({ docx: "Tab", children: [], content: "plain" }),
  PageNumber: spec<{ readonly field: (typeof docx.PageNumber)[keyof typeof docx.PageNumber] }>()({
    docx: null,
    children: [],
    content: "plain",
  }),
  ImageRun: spec<ImageProps>()({ docx: "ImageRun", children: [], content: "plain" }),
  SymbolRun: spec<docx.ISymbolRunOptions>()({ docx: "SymbolRun", children: [], content: "plain" }),
  ExternalHyperlink: spec<{ readonly link: string }>()({
    docx: "ExternalHyperlink",
    children: INLINE,
    content: "inline",
  }),
  InternalHyperlink: spec<{ readonly anchor: string }>()({
    docx: "InternalHyperlink",
    children: INLINE,
    content: "inline",
  }),
  Bookmark: spec<{ readonly id: string }>()({
    docx: "Bookmark",
    children: INLINE,
    content: "inline",
  }),
  PageBreak: spec<{}>()({ docx: "PageBreak", children: [], content: "plain" }),
  Math: spec<{}>()({ docx: "Math", children: ["MathRun"], content: "math" }),
  MathRun: spec<{}>()({ docx: "MathRun", children: [], content: "literal" }),
  RawXml: spec<{ readonly xml: string }>()({ docx: "ImportedXmlComponent", children: [], content: "plain" }),
  Footnote: spec<{}>()({
    docx: "FootnoteReferenceRun",
    children: ["Paragraph", "Table"],
    content: "wrapped",
  }),
  Comment: spec<Omit<docx.ICommentOptions, "children">>()({
    docx: "Comment",
    children: ["Paragraph", "Table"],
    content: "wrapped",
  }),
  CommentRangeStart: spec<CommentIdProps>()({
    docx: "CommentRangeStart",
    children: [],
    content: "plain",
  }),
  CommentRangeEnd: spec<CommentIdProps>()({
    docx: "CommentRangeEnd",
    children: [],
    content: "plain",
  }),
  CommentReference: spec<CommentIdProps>()({
    docx: "CommentReference",
    children: [],
    content: "plain",
  }),
  TableOfContents: spec<{ readonly alias?: string } & docx.ITableOfContentsOptions>()({
    docx: "TableOfContents",
    children: [],
    content: "plain",
  }),
  Textbox: spec<TextboxProps>()({ docx: "Textbox", children: ["Paragraph"], content: "wrapped" }),
  InsertedTextRun: spec<InsertedTextRunProps>()({
    docx: "InsertedTextRun",
    children: RUN_CONTENT,
    content: "run",
  }),
  DeletedTextRun: spec<DeletedTextRunProps>()({
    docx: "DeletedTextRun",
    children: RUN_CONTENT,
    content: "run",
  }),
  ColumnBreak: spec<{}>()({ docx: "ColumnBreak", children: [], content: "plain" }),
  SimpleField: spec<{ readonly instruction: string; readonly cachedValue?: string }>()({
    docx: "SimpleField",
    children: [],
    content: "plain",
  }),
  SimpleMailMergeField: spec<{ readonly fieldName: string }>()({
    docx: "SimpleMailMergeField",
    children: [],
    content: "plain",
  }),
  SequentialIdentifier: spec<{ readonly identifier: string }>()({
    docx: "SequentialIdentifier",
    children: [],
    content: "plain",
  }),
  PageReference: spec<{ readonly bookmarkId: string } & docx.IPageReferenceOptions>()({
    docx: "PageReference",
    children: [],
    content: "plain",
  }),
  CheckBox: spec<docx.ICheckboxSymbolOptions>()({ docx: "CheckBox", children: [], content: "plain" }),
  PositionalTab: spec<docx.PositionalTabOptions>()({
    docx: "PositionalTab",
    children: [],
    content: "plain",
  }),
  CarriageReturn: spec<{}>()({ docx: "CarriageReturn", children: [], content: "plain" }),
  SoftHyphen: spec<{}>()({ docx: "SoftHyphen", children: [], content: "plain" }),
  NoBreakHyphen: spec<{}>()({ docx: "NoBreakHyphen", children: [], content: "plain" }),
  DayShort: spec<{}>()({ docx: "DayShort", children: [], content: "plain" }),
  DayLong: spec<{}>()({ docx: "DayLong", children: [], content: "plain" }),
  MonthShort: spec<{}>()({ docx: "MonthShort", children: [], content: "plain" }),
  MonthLong: spec<{}>()({ docx: "MonthLong", children: [], content: "plain" }),
  YearShort: spec<{}>()({ docx: "YearShort", children: [], content: "plain" }),
  YearLong: spec<{}>()({ docx: "YearLong", children: [], content: "plain" }),
} as const satisfies Record<string, Spec<unknown>>;

export type Kind = keyof typeof ELEMENTS;
export type Props<K extends Kind> = NonNullable<(typeof ELEMENTS)[K]["props"]>;
export type ChildKind<K extends Kind> = (typeof ELEMENTS)[K]["children"][number] & Kind;
type Strings<K extends Kind> = (typeof ELEMENTS)[K]["content"] extends "run" | "literal" ? string : never;
export type Node<K extends Kind = Kind> = K extends Kind
  ? {
      readonly type: K;
      readonly props: Props<K>;
      readonly children: readonly (Node<ChildKind<K>> | Strings<K>)[];
    }
  : never;
export type DocumentNode = Node<"Document">;

export const isKind = (type: string): type is Kind =>
  Object.prototype.hasOwnProperty.call(ELEMENTS, type);

export const OUTSIDE_BODY: readonly Kind[] = ["Header", "Footer", "Comment", "Footnote"];

const MATH_SLOTS = "named slots need a slot-component design (out of scope); author as <RawXml> OMML meanwhile";

export const NOT_MAPPED: Readonly<Record<string, string>> = {
  Comments: "the comments part container; built from <Comment> children of Document",
  AnnotationReference: "written by docx.js inside comment parts",
  FootnoteReferenceElement: "written by docx.js inside footnote parts",
  Separator: "a footnote separator, written by docx.js",
  ContinuationSeparator: "a footnote continuation separator, written by docx.js",
  EndnoteReference: "docx.js has no endnotes part (out of scope)",
  LastRenderedPageBreak: "a layout cache Word writes and recomputes",
  PageNumberElement: "written by docx.js for PageNumber field values",
  MathFraction: MATH_SLOTS,
  MathSum: MATH_SLOTS,
  MathIntegral: MATH_SLOTS,
  MathSuperScript: MATH_SLOTS,
  MathSubScript: MATH_SLOTS,
  MathSubSuperScript: MATH_SLOTS,
  MathRadical: MATH_SLOTS,
  MathFunction: MATH_SLOTS,
  MathRoundBrackets: MATH_SLOTS,
  MathCurlyBrackets: MATH_SLOTS,
  MathAngledBrackets: MATH_SLOTS,
  MathSquareBrackets: MATH_SLOTS,
};
