import * as docx from "docx";
import { OUTSIDE_BODY, type DocumentNode, type Kind, type Node } from "../schema/elements";
import { rawXmlComponents } from "./raw-xml";

/** What each kind's builder returns: the docx.js object, or the option bag its parent takes. */
type Built = {
  Document: docx.Document;
  Section: docx.ISectionOptions;
  Header: docx.Header;
  Footer: docx.Footer;
  Paragraph: docx.Paragraph;
  TextRun: docx.TextRun;
  Table: docx.Table;
  TableRow: docx.TableRow;
  TableCell: docx.TableCell;
  Tab: docx.Tab;
  PageNumber: (typeof docx.PageNumber)[keyof typeof docx.PageNumber];
  ImageRun: docx.ImageRun;
  SymbolRun: docx.SymbolRun;
  ExternalHyperlink: docx.ExternalHyperlink;
  InternalHyperlink: docx.InternalHyperlink;
  Bookmark: docx.Bookmark;
  PageBreak: docx.PageBreak;
  Math: docx.Math;
  MathRun: docx.MathRun;
  /** One component per top-level element of the fragment, written in the RawXml's place. */
  RawXml: docx.XmlComponent[];
  Footnote: docx.FootnoteReferenceRun;
  /** Not built in place: the Document collects it into its `comments` option. */
  Comment: docx.ICommentOptions;
  CommentRangeStart: docx.CommentRangeStart;
  CommentRangeEnd: docx.CommentRangeEnd;
  /** Spliced into its run like a RawXml's components: docx.js writes it inside `<w:r>`,
   *  but its run child union leaves it out. */
  CommentReference: docx.XmlComponent[];
  TableOfContents: docx.TableOfContents;
  Textbox: docx.Textbox;
  InsertedTextRun: docx.InsertedTextRun;
  DeletedTextRun: docx.DeletedTextRun;
  ColumnBreak: docx.ColumnBreak;
  SimpleField: docx.SimpleField;
  SimpleMailMergeField: docx.SimpleMailMergeField;
  SequentialIdentifier: docx.SequentialIdentifier;
  /** Spliced into its parent like a RawXml's components: docx.js writes it as a paragraph child,
   *  but its ParagraphChild union leaves it out. */
  PageReference: docx.XmlComponent[];
  CheckBox: docx.CheckBox;
  PositionalTab: docx.PositionalTab;
  CarriageReturn: docx.CarriageReturn;
  SoftHyphen: docx.SoftHyphen;
  NoBreakHyphen: docx.NoBreakHyphen;
  DayShort: docx.DayShort;
  DayLong: docx.DayLong;
  MonthShort: docx.MonthShort;
  MonthLong: docx.MonthLong;
  YearShort: docx.YearShort;
  YearLong: docx.YearLong;
};

/** What building a node needs beyond the node: per-build, so two documents rendered in one process both start at 1. */
type BuildCtx = { readonly footnoteIds: ReadonlyMap<Node<"Footnote">, number> };

type HeaderFooterSlots<T> = { default?: T; first?: T; even?: T };

/** Builds one canonical node of any kind. */
function build<N extends Node>(node: N, ctx: BuildCtx): Built[N["type"]] {
  // The one cast: TypeScript cannot correlate BUILD[node.type] with node, though BUILD's type pairs each kind's
  // builder with that kind's node.
  const builder = BUILD[node.type] as unknown as (node: N, ctx: BuildCtx) => Built[N["type"]];
  return builder(node, ctx);
}

function buildAll<N extends Node>(nodes: readonly N[], ctx: BuildCtx): Built[N["type"]][] {
  return nodes.map((node) => build(node, ctx));
}

/** docx.js's child unions are closed and its FileChild type is branded, so they admit no raw component, and
 *  some leave out content docx.js writes correctly. At runtime docx.js pushes any XmlComponent child into its
 *  parent as-is. */
function asChildren<T>(components: docx.XmlComponent[]): T[] {
  return components as unknown as T[];
}

/** Built children in order, with each RawXml's components spliced in where the RawXml stood. */
function inPlace<T>(built: readonly (T | docx.XmlComponent[])[]): T[] {
  return built.flatMap((item) => (Array.isArray(item) ? asChildren<T>(item) : [item]));
}

/** Footnotes in body order: depth first through the Sections, never into an OUTSIDE_BODY kind,
 *  which canonical rule 18 keeps footnotes out of. */
function bodyFootnotes(document: DocumentNode): Node<"Footnote">[] {
  const found: Node<"Footnote">[] = [];
  const visit = (node: Node): void => {
    if (node.type === "Footnote") found.push(node);
    else if (!OUTSIDE_BODY.includes(node.type)) {
      for (const child of node.children) if (typeof child !== "string") visit(child);
    }
  };
  visit(document);
  return found;
}

function footnoteId(node: Node<"Footnote">, ctx: BuildCtx): number {
  const id = ctx.footnoteIds.get(node);
  if (id === undefined) throw new Error("A Footnote outside the document body: the tree must come from canonicalize");
  return id;
}

/** docx.js's `footnotes` option: each footnote's content under its number. docx.js types that content as
 *  Paragraphs; it writes a Table after the first Paragraph just as well. */
function footnoteBodies(footnotes: readonly Node<"Footnote">[], ctx: BuildCtx) {
  return Object.fromEntries(
    footnotes.map((footnote) => [
      footnoteId(footnote, ctx),
      { children: asChildren<docx.Paragraph>(buildAll(footnote.children, ctx)) },
    ])
  );
}

/** Canonical tree → docx.js Document. The tree must come from `canonicalize`.
 *
 *  Footnotes are numbered 1..n in body order; docx.js reserves −1 and 0 for its separators.
 *
 *  Raw styles are appended after docx.js has built its own. Passing them as docx.js's `importedStyles`
 *  would replace its whole default style list, since it spreads `styles` over its defaults. */
export function buildDocument(node: DocumentNode): docx.Document {
  const { styles, ...rest } = node.props;
  const { importedStyles = [], ...docxStyles } = styles ?? {};
  const footnotes = bodyFootnotes(node);
  const ctx: BuildCtx = { footnoteIds: new Map(footnotes.map((footnote, i) => [footnote, i + 1])) };
  const sections: docx.ISectionOptions[] = [];
  const comments: docx.ICommentOptions[] = [];
  for (const child of node.children) {
    if (child.type === "Section") sections.push(build(child, ctx));
    else comments.push(build(child, ctx));
  }
  // footnotes and comments are only given when there are some, so documents without notes are written as before.
  const document = new docx.Document({
    ...rest,
    ...(styles === undefined ? {} : { styles: docxStyles }),
    sections,
    ...(footnotes.length > 0 ? { footnotes: footnoteBodies(footnotes, ctx) } : {}),
    ...(comments.length > 0 ? { comments: { children: comments } } : {}),
  });
  for (const xml of importedStyles) {
    for (const style of rawXmlComponents(xml)) document.Styles.addChildElement(style);
  }
  return document;
}

function buildSection(node: Node<"Section">, ctx: BuildCtx): docx.ISectionOptions {
  const headers: HeaderFooterSlots<docx.Header> = {};
  const footers: HeaderFooterSlots<docx.Footer> = {};
  const children: docx.FileChild[] = [];
  for (const child of node.children) {
    if (child.type === "Header") headers[child.props.type] = build(child, ctx);
    else if (child.type === "Footer") footers[child.props.type] = build(child, ctx);
    else children.push(...inPlace([build(child, ctx)]));
  }
  return { ...node.props, headers, footers, children };
}

/** The three run kinds share their content kinds. */
type RunChild = Node<"TextRun">["children"][number];
type RunChildren = { readonly children?: NonNullable<docx.IRunOptions["children"]> };

/** A canonical run holds either string and run-content children or, alone, a `text` literal.
 *  docx.js ignores `text` whenever `children` is truthy, even `[]`, so a childless run passes `undefined`. */
function buildRun<P, R>(
  Run: new (options: NoInfer<P> & RunChildren) => R,
  { props, children }: { readonly props: P; readonly children: readonly RunChild[] },
  ctx: BuildCtx
): R {
  const built = children.map((child) => (typeof child === "string" ? child : build(child, ctx)));
  return new Run({ ...props, children: built.length === 0 ? undefined : inPlace(built) });
}

/** docx.js's DeletedTextRun writes PAGE, NUMPAGES and SECTIONPAGES as deleted fields but has no case for
 *  PageNumber.CURRENT_SECTION, which it writes as the deleted word "SECTION": that field is written here. */
const DELETED_SECTION_FIELD: Node<"RawXml"> = {
  type: "RawXml",
  props: {
    xml:
      '<w:fldChar w:fldCharType="begin"/><w:delInstrText xml:space="preserve">SECTION</w:delInstrText>' +
      '<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/>',
  },
  children: [],
};

function buildDeletedRun(node: Node<"DeletedTextRun">, ctx: BuildCtx): docx.DeletedTextRun {
  const children = node.children.map((child) =>
    typeof child === "object" && child.type === "PageNumber" && child.props.field === docx.PageNumber.CURRENT_SECTION
      ? DELETED_SECTION_FIELD
      : child
  );
  return buildRun(docx.DeletedTextRun, { props: node.props, children }, ctx);
}

/** docx.js stamps a Comment without a date with the time of writing, as `date.toISOString()`, and leaves out
 *  an attribute whose value is undefined: this date writes no `w:date`, so the same tree writes the same bytes. */
const UNDATED = { toISOString: () => undefined } as unknown as Date;

const BUILD: { readonly [K in Kind]: (node: Node<K>, ctx: BuildCtx) => Built[K] } = {
  Document: buildDocument,
  Section: buildSection,
  Header: ({ children }, ctx) => new docx.Header({ children: inPlace(buildAll(children, ctx)) }),
  Footer: ({ children }, ctx) => new docx.Footer({ children: inPlace(buildAll(children, ctx)) }),
  Paragraph: ({ props, children }, ctx) => new docx.Paragraph({ ...props, children: inPlace(buildAll(children, ctx)) }),
  TextRun: (node, ctx) => buildRun(docx.TextRun, node, ctx),
  Table: ({ props, children }, ctx) => new docx.Table({ ...props, rows: buildAll(children, ctx) }),
  TableRow: ({ props, children }, ctx) => new docx.TableRow({ ...props, children: buildAll(children, ctx) }),
  TableCell: ({ props, children }, ctx) =>
    new docx.TableCell({ ...props, children: inPlace(buildAll(children, ctx)) }),
  Tab: () => new docx.Tab(),
  // The docx.js field sentinel: a run child string equal to a PageNumber value is written as that field.
  PageNumber: ({ props }) => props.field,
  ImageRun: ({ props }) => new docx.ImageRun(props),
  SymbolRun: ({ props }) => new docx.SymbolRun(props),
  ExternalHyperlink: ({ props, children }, ctx) =>
    new docx.ExternalHyperlink({ link: props.link, children: inPlace(buildAll(children, ctx)) }),
  InternalHyperlink: ({ props, children }, ctx) =>
    new docx.InternalHyperlink({ anchor: props.anchor, children: inPlace(buildAll(children, ctx)) }),
  Bookmark: ({ props, children }, ctx) =>
    new docx.Bookmark({ id: props.id, children: inPlace(buildAll(children, ctx)) }),
  PageBreak: () => new docx.PageBreak(),
  Math: ({ children }, ctx) => new docx.Math({ children: buildAll(children, ctx) }),
  MathRun: ({ children }) => new docx.MathRun(children.join("")),
  RawXml: ({ props }) => rawXmlComponents(props.xml),
  // The footnote's content is built once, by the Document, into its `footnotes` option.
  Footnote: (node, ctx) => new docx.FootnoteReferenceRun(footnoteId(node, ctx)),
  Comment: ({ props, children }, ctx) => ({ ...props, date: props.date ?? UNDATED, children: buildAll(children, ctx) }),
  CommentRangeStart: ({ props }) => new docx.CommentRangeStart(props.id),
  CommentRangeEnd: ({ props }) => new docx.CommentRangeEnd(props.id),
  CommentReference: ({ props }) => [new docx.CommentReference(props.id)],
  TableOfContents: ({ props: { alias, ...options } }) => new docx.TableOfContents(alias, options),
  // docx.js types a Textbox's children as inline content but writes them into <w:txbxContent>, which holds
  // paragraphs: the element table gives it Paragraph children.
  Textbox: ({ props, children }, ctx) =>
    new docx.Textbox({ ...props, children: asChildren<docx.ParagraphChild>(buildAll(children, ctx)) }),
  InsertedTextRun: (node, ctx) => buildRun(docx.InsertedTextRun, node, ctx),
  DeletedTextRun: buildDeletedRun,
  ColumnBreak: () => new docx.ColumnBreak(),
  SimpleField: ({ props }) => new docx.SimpleField(props.instruction, props.cachedValue),
  SimpleMailMergeField: ({ props }) => new docx.SimpleMailMergeField(props.fieldName),
  SequentialIdentifier: ({ props }) => new docx.SequentialIdentifier(props.identifier),
  PageReference: ({ props: { bookmarkId, ...options } }) => [new docx.PageReference(bookmarkId, options)],
  CheckBox: ({ props }) => new docx.CheckBox(props),
  PositionalTab: ({ props }) => new docx.PositionalTab(props),
  CarriageReturn: () => new docx.CarriageReturn(),
  SoftHyphen: () => new docx.SoftHyphen(),
  NoBreakHyphen: () => new docx.NoBreakHyphen(),
  DayShort: () => new docx.DayShort(),
  DayLong: () => new docx.DayLong(),
  MonthShort: () => new docx.MonthShort(),
  MonthLong: () => new docx.MonthLong(),
  YearShort: () => new docx.YearShort(),
  YearLong: () => new docx.YearLong(),
};

