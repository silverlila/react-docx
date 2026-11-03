import type * as docx from "docx";

/** What one kind is. Data only: the writer, and later the reader and the HTML preview,
 *  each keep their own exhaustive `{ [K in Kind]: … }` record checked against this table. */
type Spec<P> = {
  /** The docx.js export this kind constructs; null when it folds into a parent's option. */
  readonly docx: string | null;
  /** Legal child kinds in canonical form. */
  readonly children: readonly string[];
  /** Whether the kind may hold literal string children. */
  readonly text: boolean;
  /** The OOXML element names it corresponds to. */
  readonly ooxml: readonly string[];
  /** Phantom: never set at runtime, carries the props type. */
  readonly props?: P;
};

/** Curried so that `P` is given explicitly while the row itself keeps its literal types
 *  (`text: true`, the exact child tuple), which `Node<K>` reads. */
const spec =
  <P>() =>
  <const S extends Omit<Spec<P>, "props">>(row: S): S & { readonly props?: P } =>
    row;

const BLOCK = ["Paragraph", "Table"] as const;
const INLINE = [
  "TextRun",
  "ImageRun",
  "SymbolRun",
  "ExternalHyperlink",
  "InternalHyperlink",
  "Bookmark",
  "PageBreak",
  "Math",
] as const;
const RUN_CONTENT = ["Tab", "PageNumber"] as const;

export type StylesProps = Omit<docx.IStylesOptions, "importedStyles" | "initialStyles">;
export type DocumentProps = Omit<
  docx.IPropertiesOptions,
  "sections" | "footnotes" | "comments" | "externalStyles" | "styles"
> & { readonly styles?: StylesProps };
type RasterImage = { readonly type: "jpg" | "png" | "gif" | "bmp"; readonly data: Uint8Array };
export type ImageProps = Omit<docx.IImageOptions, "type" | "data" | "fallback"> &
  (RasterImage | { readonly type: "svg"; readonly data: Uint8Array; readonly fallback: RasterImage });
type HeaderFooterProps = { readonly type: "default" | "first" | "even" };

export const ELEMENTS = {
  Document: spec<DocumentProps>()({
    docx: "Document",
    children: ["Section"],
    text: false,
    ooxml: ["w:document"],
  }),
  Section: spec<Omit<docx.ISectionOptions, "children" | "headers" | "footers">>()({
    docx: null,
    children: ["Header", "Footer", ...BLOCK],
    text: false,
    ooxml: ["w:sectPr"],
  }),
  Header: spec<HeaderFooterProps>()({ docx: "Header", children: BLOCK, text: false, ooxml: ["w:hdr"] }),
  Footer: spec<HeaderFooterProps>()({ docx: "Footer", children: BLOCK, text: false, ooxml: ["w:ftr"] }),
  Paragraph: spec<Omit<docx.IParagraphOptions, "children" | "text" | "heading">>()({
    docx: "Paragraph",
    children: INLINE,
    text: false,
    ooxml: ["w:p"],
  }),
  /** `text` appears only on a childless run holding a literal docx.js would misread as a child:
   *  `""` or a PageNumber value. Every other literal is a string child. */
  TextRun: spec<Omit<docx.IRunOptions, "children">>()({
    docx: "TextRun",
    children: RUN_CONTENT,
    text: true,
    ooxml: ["w:r"],
  }),
  Table: spec<Omit<docx.ITableOptions, "rows">>()({
    docx: "Table",
    children: ["TableRow"],
    text: false,
    ooxml: ["w:tbl"],
  }),
  TableRow: spec<Omit<docx.ITableRowOptions, "children">>()({
    docx: "TableRow",
    children: ["TableCell"],
    text: false,
    ooxml: ["w:tr"],
  }),
  TableCell: spec<Omit<docx.ITableCellOptions, "children">>()({
    docx: "TableCell",
    children: BLOCK,
    text: false,
    ooxml: ["w:tc"],
  }),
  Tab: spec<{}>()({ docx: "Tab", children: [], text: false, ooxml: ["w:tab"] }),
  PageNumber: spec<{ readonly field: (typeof docx.PageNumber)[keyof typeof docx.PageNumber] }>()({
    docx: null,
    children: [],
    text: false,
    ooxml: ["w:fldSimple", "w:instrText"],
  }),
  ImageRun: spec<ImageProps>()({ docx: "ImageRun", children: [], text: false, ooxml: ["w:drawing"] }),
  SymbolRun: spec<docx.ISymbolRunOptions>()({ docx: "SymbolRun", children: [], text: false, ooxml: ["w:sym"] }),
  ExternalHyperlink: spec<{ readonly link: string }>()({
    docx: "ExternalHyperlink",
    children: INLINE,
    text: false,
    ooxml: ["w:hyperlink"],
  }),
  InternalHyperlink: spec<{ readonly anchor: string }>()({
    docx: "InternalHyperlink",
    children: INLINE,
    text: false,
    ooxml: ["w:hyperlink"],
  }),
  Bookmark: spec<{ readonly id: string }>()({
    docx: "Bookmark",
    children: INLINE,
    text: false,
    ooxml: ["w:bookmarkStart"],
  }),
  PageBreak: spec<{}>()({ docx: "PageBreak", children: [], text: false, ooxml: ["w:br"] }),
  Math: spec<{}>()({ docx: "Math", children: ["MathRun"], text: false, ooxml: ["m:oMath"] }),
  MathRun: spec<{}>()({ docx: "MathRun", children: [], text: true, ooxml: ["m:r"] }),
} as const satisfies Record<string, Spec<unknown>>;

export type Kind = keyof typeof ELEMENTS;
export type Props<K extends Kind> = NonNullable<(typeof ELEMENTS)[K]["props"]>;
type ChildKind<K extends Kind> = (typeof ELEMENTS)[K]["children"][number] & Kind;
type Strings<K extends Kind> = (typeof ELEMENTS)[K]["text"] extends true ? string : never;
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
