/** Builds docx.js objects from a canonical tree.
 *
 *  docx.js facts the builders work around:
 *  - Its child unions are closed and FileChild is branded, so they admit no raw component. Some also
 *    leave out content docx.js writes correctly: CommentReference inside `<w:r>`, PageReference as a
 *    paragraph child. At runtime docx.js pushes any XmlComponent child as-is.
 *  - Textbox types its children as inline content but writes them into `<w:txbxContent>`.
 *  - The `footnotes` option types content as Paragraphs, but a Table after the first Paragraph is
 *    written just as well. It reserves footnote ids −1 and 0 for its separators, so footnotes are
 *    numbered 1..n.
 *  - It spreads `styles` over its default style list, so raw styles passed as `importedStyles` would
 *    replace every default.
 *  - It ignores a run's `text` whenever `children` is truthy, even `[]`.
 *  - DeletedTextRun has no case for PageNumber.CURRENT_SECTION and writes the deleted word "SECTION",
 *    so that field is written as raw XML.
 *  - It stamps a Comment with no date with the time of writing, via `date.toISOString()`, and leaves out
 *    an attribute whose value is undefined. An undated Comment gets a date whose toISOString returns
 *    undefined, so it writes no w:date.
 *  - It writes a run child string equal to a PageNumber value as that field. */

import * as docx from "docx";
import type { DocumentNode, Kind, Node } from "../schema/elements";
import { rawXmlComponents } from "./raw-xml";

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
  RawXml: docx.XmlComponent[];
  Footnote: docx.FootnoteReferenceRun;
  Comment: docx.ICommentOptions;
  CommentRangeStart: docx.CommentRangeStart;
  CommentRangeEnd: docx.CommentRangeEnd;
  CommentReference: docx.XmlComponent[];
  TableOfContents: docx.TableOfContents;
  Textbox: docx.Textbox;
  InsertedTextRun: docx.InsertedTextRun;
  DeletedTextRun: docx.DeletedTextRun;
  ColumnBreak: docx.ColumnBreak;
  SimpleField: docx.SimpleField;
  SimpleMailMergeField: docx.SimpleMailMergeField;
  SequentialIdentifier: docx.SequentialIdentifier;
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

type BuildCtx = { readonly footnotes: Node<"Footnote">[] };

type HeaderFooterSlots<T> = { default?: T; first?: T; even?: T };

function build<N extends Node>(node: N, ctx: BuildCtx): Built[N["type"]] {
  const builder = BUILD[node.type] as unknown as (node: N, ctx: BuildCtx) => Built[N["type"]];
  return builder(node, ctx);
}

function buildAll<N extends Node>(nodes: readonly N[], ctx: BuildCtx): Built[N["type"]][] {
  return nodes.map((node) => build(node, ctx));
}

function asChildren<T>(components: docx.XmlComponent[]): T[] {
  return components as unknown as T[];
}

function inPlace<T>(built: readonly (T | docx.XmlComponent[])[]): T[] {
  return built.flatMap((item) => (Array.isArray(item) ? asChildren<T>(item) : [item]));
}

function buildFootnoteReference(node: Node<"Footnote">, ctx: BuildCtx): docx.FootnoteReferenceRun {
  ctx.footnotes.push(node);
  return new docx.FootnoteReferenceRun(ctx.footnotes.length);
}

function footnoteBodies(ctx: BuildCtx) {
  return Object.fromEntries(
    ctx.footnotes.map((footnote, i) => [
      i + 1,
      { children: asChildren<docx.Paragraph>(buildAll(footnote.children, ctx)) },
    ]),
  );
}

export function buildDocument(node: DocumentNode): docx.Document {
  const { styles, ...rest } = node.props;
  const { importedStyles = [], ...docxStyles } = styles ?? {};
  const ctx: BuildCtx = { footnotes: [] };
  const sections: docx.ISectionOptions[] = [];
  const comments: docx.ICommentOptions[] = [];
  for (const child of node.children) {
    if (child.type === "Section") sections.push(build(child, ctx));
    else comments.push(build(child, ctx));
  }
  const document = new docx.Document({
    ...rest,
    ...(styles === undefined ? {} : { styles: docxStyles }),
    sections,
    ...(ctx.footnotes.length > 0 ? { footnotes: footnoteBodies(ctx) } : {}),
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

type RunChild = Node<"TextRun">["children"][number];
type RunChildren = { readonly children?: NonNullable<docx.IRunOptions["children"]> };

function buildRun<P, R>(
  Run: new (options: NoInfer<P> & RunChildren) => R,
  { props, children }: { readonly props: P; readonly children: readonly RunChild[] },
  ctx: BuildCtx,
): R {
  const built = children.map((child) => (typeof child === "string" ? child : build(child, ctx)));
  return new Run({ ...props, children: built.length === 0 ? undefined : inPlace(built) });
}

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
      : child,
  );
  return buildRun(docx.DeletedTextRun, { props: node.props, children }, ctx);
}

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
  TableCell: ({ props, children }, ctx) => new docx.TableCell({ ...props, children: inPlace(buildAll(children, ctx)) }),
  Tab: () => new docx.Tab(),
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
  Footnote: buildFootnoteReference,
  Comment: ({ props, children }, ctx) => ({ ...props, date: props.date ?? UNDATED, children: buildAll(children, ctx) }),
  CommentRangeStart: ({ props }) => new docx.CommentRangeStart(props.id),
  CommentRangeEnd: ({ props }) => new docx.CommentRangeEnd(props.id),
  CommentReference: ({ props }) => [new docx.CommentReference(props.id)],
  TableOfContents: ({ props: { alias, ...options } }) => new docx.TableOfContents(alias, options),
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
