import * as docx from "docx";
import type { DocumentNode, Kind, Node } from "../schema/elements";
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
};

type HeaderFooterSlots<T> = { default?: T; first?: T; even?: T };

/** Builds one canonical node of any kind. */
function build<N extends Node>(node: N): Built[N["type"]] {
  // The one cast: TypeScript cannot correlate BUILD[node.type] with node, though BUILD's type pairs each kind's
  // builder with that kind's node.
  const builder = BUILD[node.type] as unknown as (node: N) => Built[N["type"]];
  return builder(node);
}

/** docx.js's child unions are closed and its FileChild type is branded, so no raw component types as a child.
 *  At runtime docx.js pushes any XmlComponent child into its parent as-is, which is all RawXml needs. */
function asChildren<T>(components: docx.XmlComponent[]): T[] {
  return components as unknown as T[];
}

/** Built children in order, with each RawXml's components spliced in where the RawXml stood. */
function inPlace<T>(built: readonly (T | docx.XmlComponent[])[]): T[] {
  return built.flatMap((item) => (Array.isArray(item) ? asChildren<T>(item) : [item]));
}

/** Raw styles are appended after docx.js has built its own. Passing them as docx.js's `importedStyles`
 *  would replace its whole default style list, since it spreads `styles` over its defaults. */
function buildDocumentNode({ props, children }: Node<"Document">): docx.Document {
  const { styles, ...rest } = props;
  const { importedStyles = [], ...docxStyles } = styles ?? {};
  const document = new docx.Document({
    ...rest,
    ...(styles === undefined ? {} : { styles: docxStyles }),
    sections: children.map(build),
  });
  for (const xml of importedStyles) {
    for (const style of rawXmlComponents(xml)) document.Styles.addChildElement(style);
  }
  return document;
}

function buildSection(node: Node<"Section">): docx.ISectionOptions {
  const headers: HeaderFooterSlots<docx.Header> = {};
  const footers: HeaderFooterSlots<docx.Footer> = {};
  const children: (docx.Paragraph | docx.Table)[] = [];
  for (const child of node.children) {
    if (child.type === "Header") headers[child.props.type] = build(child);
    else if (child.type === "Footer") footers[child.props.type] = build(child);
    else children.push(...inPlace([build(child)]));
  }
  return { ...node.props, headers, footers, children };
}

/** A canonical TextRun holds either string and run-content children or, alone, a `text` literal.
 *  docx.js ignores `text` whenever `children` is present, even empty, so children go through only when there are some. */
function buildTextRun({ props, children }: Node<"TextRun">): docx.TextRun {
  if (children.length === 0) return new docx.TextRun(props);
  const built = children.map((child) => (typeof child === "string" ? child : build(child)));
  return new docx.TextRun({ ...props, children: inPlace(built) });
}

const BUILD: { readonly [K in Kind]: (node: Node<K>) => Built[K] } = {
  Document: buildDocumentNode,
  Section: buildSection,
  Header: ({ children }) => new docx.Header({ children: inPlace(children.map(build)) }),
  Footer: ({ children }) => new docx.Footer({ children: inPlace(children.map(build)) }),
  Paragraph: ({ props, children }) => new docx.Paragraph({ ...props, children: inPlace(children.map(build)) }),
  TextRun: buildTextRun,
  Table: ({ props, children }) => new docx.Table({ ...props, rows: children.map(build) }),
  TableRow: ({ props, children }) => new docx.TableRow({ ...props, children: children.map(build) }),
  TableCell: ({ props, children }) => new docx.TableCell({ ...props, children: inPlace(children.map(build)) }),
  Tab: () => new docx.Tab(),
  // The docx.js field sentinel: a run child string equal to a PageNumber value is written as that field.
  PageNumber: ({ props }) => props.field,
  ImageRun: ({ props }) => new docx.ImageRun(props),
  SymbolRun: ({ props }) => new docx.SymbolRun(props),
  ExternalHyperlink: ({ props, children }) =>
    new docx.ExternalHyperlink({ link: props.link, children: inPlace(children.map(build)) }),
  InternalHyperlink: ({ props, children }) =>
    new docx.InternalHyperlink({ anchor: props.anchor, children: inPlace(children.map(build)) }),
  Bookmark: ({ props, children }) => new docx.Bookmark({ id: props.id, children: inPlace(children.map(build)) }),
  PageBreak: () => new docx.PageBreak(),
  Math: ({ children }) => new docx.Math({ children: children.map(build) }),
  MathRun: ({ children }) => new docx.MathRun(children.join("")),
  RawXml: ({ props }) => rawXmlComponents(props.xml),
};

/** Canonical tree → docx.js Document. The tree must come from `canonicalize`. */
export function buildDocument(tree: DocumentNode): docx.Document {
  return build(tree);
}
