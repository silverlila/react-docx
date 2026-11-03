import type * as docx from "docx";

/** What one kind is. Data only: the writer, and later the reader and the HTML preview,
 *  each keep their own exhaustive `{ [K in Kind]: … }` record checked against this table. */
type Spec<P> = {
  /** The docx.js export this kind constructs; null when it folds into a parent's option. */
  readonly docx: string | null;
  /** Legal child kinds in canonical form. */
  readonly children: readonly string[];
  /** What its children are, which decides how loose content standing in it is read. */
  readonly content: Content;
  /** Phantom: never set at runtime, carries the props type. */
  readonly props?: P;
};

/** A kind's content model. test/content-models.test.ts checks each row's against its `children`.
 *  - `block`: paragraphs and tables. A RawXml here holds block roots.
 *  - `wrapped`: paragraphs and tables; loose text and inline content is wrapped into Paragraphs (rule 17).
 *  - `inline`: runs and other inline content; loose text, Breaks and run content are wrapped into TextRuns.
 *    A RawXml here holds inline roots.
 *  - `run`: literal text and run content, split at Breaks. A RawXml here holds run roots.
 *  - `math`: MathRuns; loose text is wrapped into one.
 *  - `literal`: literal text only.
 *  - `plain`: element children only, or none. */
export type Content = "block" | "wrapped" | "inline" | "run" | "math" | "literal" | "plain";

/** Curried so that `P` is given explicitly while the row itself keeps its literal types
 *  (`content: "run"`, the exact child tuple), which `Node<K>` reads. */
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
export type DocumentProps = Omit<
  docx.IPropertiesOptions,
  "sections" | "footnotes" | "comments" | "externalStyles" | "styles"
> & { readonly styles?: StylesProps };
type RasterImage = { readonly type: "jpg" | "png" | "gif" | "bmp"; readonly data: Uint8Array };
export type ImageProps = Omit<docx.IImageOptions, "type" | "data" | "fallback"> &
  (RasterImage | { readonly type: "svg"; readonly data: Uint8Array; readonly fallback: RasterImage });
type HeaderFooterProps = { readonly type: "default" | "first" | "even" };
/** docx.js does not export `ITextboxOptions`. */
type TextboxOptions = ConstructorParameters<typeof docx.Textbox>[0];
/** `text` is left out: docx.js's Textbox ignores it. `style` is the VML shape style, not a paragraph style. */
export type TextboxProps = Omit<TextboxOptions, "children" | "text">;
type CommentIdProps = { readonly id: number };
/** docx.js does not export the tracked-change run options. Like TextRun's, they keep `text`, which a canonical
 *  run carries only for a literal docx.js would misread as a child. `date` is a string. */
export type InsertedTextRunProps = Omit<ConstructorParameters<typeof docx.InsertedTextRun>[0], "children">;
export type DeletedTextRunProps = Omit<ConstructorParameters<typeof docx.DeletedTextRun>[0], "children">;

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
  /** `text` appears only on a childless run holding a literal docx.js would misread as a child:
   *  `""` or a PageNumber value. Every other literal is a string child. */
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
  /** One or more sibling OOXML elements docx.js cannot express, written verbatim. */
  RawXml: spec<{ readonly xml: string }>()({ docx: "ImportedXmlComponent", children: [], content: "plain" }),
  /** Stands where it is referenced and holds its own content; the writer numbers footnotes 1..n in body order. */
  Footnote: spec<{}>()({
    docx: "FootnoteReferenceRun",
    children: ["Paragraph", "Table"],
    content: "wrapped",
  }),
  /** A Document child; ranges and references mark where it applies by its id. */
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
  /** docx.js types its children as inline content but writes them straight into `<w:txbxContent>`,
   *  which holds paragraphs. */
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

/** `Object.hasOwn` is ES2022; tsconfig's lib is ES2020. */
export const isKind = (type: string): type is Kind =>
  Object.prototype.hasOwnProperty.call(ELEMENTS, type);

/** Rule 18: the kinds whose content is outside the document body. docx.js writes footnote references only
 *  from body content, so no Footnote may stand anywhere inside one of these. */
export const OUTSIDE_BODY: readonly Kind[] = ["Header", "Footer", "Comment", "Footnote"];

const MATH_SLOTS = "named slots need a slot-component design (out of scope); author as <RawXml> OMML meanwhile";

/** docx.js content classes that are not kinds, each with why. test/coverage.test.ts fails on a content class
 *  that is neither some `ELEMENTS[k].docx` nor a key here, and on a key that is no longer a content class. */
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
