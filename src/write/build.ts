import * as docx from "docx";
import type { DocumentNode, Kind, Node } from "../schema/elements";

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
};

type HeaderFooterSlots<T> = { default?: T; first?: T; even?: T };

/** Builds one canonical node of any kind. */
function build<N extends Node>(node: N): Built[N["type"]] {
  // The one cast: TypeScript cannot correlate BUILD[node.type] with node, though BUILD's type pairs each kind's
  // builder with that kind's node.
  const builder = BUILD[node.type] as unknown as (node: N) => Built[N["type"]];
  return builder(node);
}

function buildSection(node: Node<"Section">): docx.ISectionOptions {
  const headers: HeaderFooterSlots<docx.Header> = {};
  const footers: HeaderFooterSlots<docx.Footer> = {};
  const children: (docx.Paragraph | docx.Table)[] = [];
  for (const child of node.children) {
    if (child.type === "Header") headers[child.props.type] = build(child);
    else if (child.type === "Footer") footers[child.props.type] = build(child);
    else children.push(build(child));
  }
  return { ...node.props, headers, footers, children };
}

/** A canonical TextRun holds either string and run-content children or, alone, a `text` literal.
 *  docx.js ignores `text` whenever `children` is present, even empty, so children go through only when there are some. */
function buildTextRun({ props, children }: Node<"TextRun">): docx.TextRun {
  if (children.length === 0) return new docx.TextRun(props);
  return new docx.TextRun({ ...props, children: children.map((child) => (typeof child === "string" ? child : build(child))) });
}

const BUILD: { readonly [K in Kind]: (node: Node<K>) => Built[K] } = {
  Document: ({ props, children }) => new docx.Document({ ...props, sections: children.map(build) }),
  Section: buildSection,
  Header: ({ children }) => new docx.Header({ children: children.map(build) }),
  Footer: ({ children }) => new docx.Footer({ children: children.map(build) }),
  Paragraph: ({ props, children }) => new docx.Paragraph({ ...props, children: children.map(build) }),
  TextRun: buildTextRun,
  Table: ({ props, children }) => new docx.Table({ ...props, rows: children.map(build) }),
  TableRow: ({ props, children }) => new docx.TableRow({ ...props, children: children.map(build) }),
  TableCell: ({ props, children }) => new docx.TableCell({ ...props, children: children.map(build) }),
  Tab: () => new docx.Tab(),
  // The docx.js field sentinel: a run child string equal to a PageNumber value is written as that field.
  PageNumber: ({ props }) => props.field,
  ImageRun: ({ props }) => new docx.ImageRun(props),
  SymbolRun: ({ props }) => new docx.SymbolRun(props),
  ExternalHyperlink: ({ props, children }) =>
    new docx.ExternalHyperlink({ link: props.link, children: children.map(build) }),
  InternalHyperlink: ({ props, children }) =>
    new docx.InternalHyperlink({ anchor: props.anchor, children: children.map(build) }),
  Bookmark: ({ props, children }) => new docx.Bookmark({ id: props.id, children: children.map(build) }),
  PageBreak: () => new docx.PageBreak(),
  Math: ({ children }) => new docx.Math({ children: children.map(build) }),
  MathRun: ({ children }) => new docx.MathRun(children.join("")),
};

/** Canonical tree → docx.js Document. The tree must come from `canonicalize`. */
export function buildDocument(tree: DocumentNode): docx.Document {
  return build(tree);
}
