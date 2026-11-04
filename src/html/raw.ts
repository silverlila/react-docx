/** What the preview draws for RawXml: the reader keeps content verbatim where no tree kind maps it (content
 *  controls, smart tags, custom XML, simple fields, Word's tables of contents), and Word shows that
 *  content. rawBlocks and rawInlines read it into the tree kinds resolveDocument draws, with the reader's
 *  own codecs.
 *
 *  - Wrappers (w:sdt, w:smartTag, w:customXml, w:fldSimple, w:ins) are read through; w:del is left out.
 *  - A complex field shows its result and hides its instruction, across paragraphs: a table of contents
 *    is one field whose result is its entries.
 *  - The fragment comes without its package, so a hyperlink to an external target keeps only its text,
 *    pictures, notes and objects are left out, a numbered paragraph draws without its marker (its numId
 *    names no tree list), and theme fonts fall back to the style's. */

import type { CodecEnv } from "../ooxml/codec";
import { readParagraphProperties } from "../ooxml/paragraph";
import { readRunProperties } from "../ooxml/run";
import { readCellProperties, readRowProperties, readTableProperties } from "../ooxml/table";
import { attrOf, childNamed, elementsOf, parseXml, textOf, type XmlElement } from "../ooxml/xml";
import type { ChildKind, Node } from "../schema/elements";

type BlockNode = Node<"Paragraph" | "Table">;
type InlineNode = Node<ChildKind<"Paragraph">>;
type RunChild = Node<ChildKind<"TextRun">> | string;

/** A complex field: its instruction so far, and whether its result is showing. A page-number field's
 *  result is replaced by the page's own number, so its cached result is hidden. */
type Field = { instruction: string; phase: "instruction" | "result" | "replaced" };

/** The open complex fields, outermost first; text shows only when every one of them is in its result. */
type Walk = { readonly env: CodecEnv; readonly fields: Field[] };

const PAGE_FIELDS: readonly (readonly [RegExp, string])[] = [
  [/^\s*PAGE\b/i, "CURRENT"],
  [/^\s*NUMPAGES\b/i, "TOTAL_PAGES"],
  [/^\s*SECTIONPAGES\b/i, "TOTAL_PAGES_IN_SECTION"],
];

const NO_FONTS = { latin: null, eastAsia: null, complex: null };
const ENV: CodecEnv = { theme: { fonts: { major: NO_FONTS, minor: NO_FONTS }, colors: {} } };

const WRAPPERS = new Set(["w:sdt", "w:smartTag", "w:customXml", "w:fldSimple", "w:ins", "w:moveTo"]);

const node = <T extends string>(type: T, props: object, children: readonly unknown[] = []) =>
  ({ type, props, children }) as never;

function wrapped(el: XmlElement): readonly XmlElement[] {
  return el.name === "w:sdt" ? elementsOf(childNamed(el, "w:sdtContent")) : elementsOf(el);
}

const showing = (walk: Walk): boolean => walk.fields.every((field) => field.phase === "result");

/** A page-number field reaching its result, as the PageNumber it shows; null for any other field char. */
function fieldChar(el: XmlElement, walk: Walk): RunChild | null {
  const type = attrOf(el, "w:fldCharType");
  const open = walk.fields[walk.fields.length - 1];
  if (type === "begin") {
    walk.fields.push({ instruction: "", phase: "instruction" });
  } else if (type === "separate" && open !== undefined) {
    const page = PAGE_FIELDS.find(([pattern]) => pattern.test(open.instruction));
    const outer = walk.fields.slice(0, -1).every((field) => field.phase === "result");
    open.phase = page === undefined ? "result" : "replaced";
    if (page !== undefined && outer) return node("PageNumber", { field: page[1] });
  } else if (type === "end") {
    walk.fields.pop();
  }
  return null;
}

function runChildren(r: XmlElement, walk: Walk): { children: RunChild[]; pageBreaks: number } {
  const children: RunChild[] = [];
  let pageBreaks = 0;
  for (const el of elementsOf(r)) {
    if (el.name === "w:fldChar") {
      const page = fieldChar(el, walk);
      if (page !== null) children.push(page);
      continue;
    }
    if (el.name === "w:instrText") {
      const open = walk.fields[walk.fields.length - 1];
      if (open !== undefined && open.phase === "instruction") open.instruction += textOf(el);
      continue;
    }
    if (!showing(walk)) continue;
    switch (el.name) {
      case "w:t":
        children.push(textOf(el));
        break;
      case "w:tab":
        children.push(node("Tab", {}));
        break;
      case "w:br":
        if (attrOf(el, "w:type") === "page") pageBreaks++;
        else children.push(node("CarriageReturn", {}));
        break;
      case "w:cr":
        children.push(node("CarriageReturn", {}));
        break;
      case "w:noBreakHyphen":
        children.push(node("NoBreakHyphen", {}));
        break;
      case "w:softHyphen":
        children.push(node("SoftHyphen", {}));
        break;
      case "w:lastRenderedPageBreak":
        children.push(node("RawXml", { xml: "<w:lastRenderedPageBreak/>" }));
        break;
      default:
        break;
    }
  }
  return { children, pageBreaks };
}

function run(r: XmlElement, walk: Walk): InlineNode[] {
  const props = readRunProperties(childNamed(r, "w:rPr"), walk.env).options;
  const sym = childNamed(r, "w:sym");
  const { children, pageBreaks } = runChildren(r, walk);
  const out: InlineNode[] = [];
  if (sym !== null && showing(walk) && attrOf(sym, "w:char") !== null) {
    const font = attrOf(sym, "w:font");
    out.push(node("SymbolRun", { ...props, char: attrOf(sym, "w:char"), ...(font === null ? {} : { symbolfont: font }) }));
  }
  if (children.length > 0) out.push(node("TextRun", props, children));
  for (let i = 0; i < pageBreaks; i++) out.push(node("PageBreak", {}));
  return out;
}

function inlines(elements: readonly XmlElement[], walk: Walk): InlineNode[] {
  return elements.flatMap((el): InlineNode[] => {
    if (el.name === "w:r") return run(el, walk);
    if (el.name === "w:fldSimple") {
      const page = PAGE_FIELDS.find(([pattern]) => pattern.test(attrOf(el, "w:instr") ?? ""));
      if (page === undefined) return inlines(elementsOf(el), walk);
      if (!showing(walk)) return [];
      const props = readRunProperties(childNamed(childNamed(el, "w:r"), "w:rPr"), walk.env).options;
      return [node("TextRun", props, [node("PageNumber", { field: page[1] })])];
    }
    if (WRAPPERS.has(el.name)) return inlines(wrapped(el), walk);
    if (el.name === "w:hyperlink") {
      const children = inlines(elementsOf(el), walk);
      const anchor = attrOf(el, "w:anchor");
      return anchor === null ? children : [node("InternalHyperlink", { anchor }, children)];
    }
    if (el.name === "m:oMath" || el.name === "m:oMathPara") {
      const text = el.name === "m:oMath" ? textOf(el) : elementsOf(el).map(textOf).join(" ");
      return showing(walk) && text.length > 0 ? [node("TextRun", { italics: true }, [text])] : [];
    }
    return [];
  });
}

function paragraph(p: XmlElement, walk: Walk): BlockNode {
  const props = readParagraphProperties(childNamed(p, "w:pPr"), walk.env).options;
  return node("Paragraph", props, inlines(elementsOf(p), walk));
}

function cell(tc: XmlElement, walk: Walk): Node<"TableCell"> {
  const props = readCellProperties(childNamed(tc, "w:tcPr"), walk.env).options;
  const children = blocks(elementsOf(tc), walk);
  return node("TableCell", props, children.length === 0 ? [node("Paragraph", {})] : children);
}

function rows(elements: readonly XmlElement[], walk: Walk): Node<"TableRow">[] {
  return elements.flatMap((el): Node<"TableRow">[] => {
    if (el.name === "w:tr") {
      const props = readRowProperties(childNamed(el, "w:trPr"), walk.env).options;
      const cells = cellsOf(elementsOf(el), walk);
      return cells.length === 0 ? [] : [node("TableRow", props, cells)];
    }
    return WRAPPERS.has(el.name) ? rows(wrapped(el), walk) : [];
  });
}

function cellsOf(elements: readonly XmlElement[], walk: Walk): Node<"TableCell">[] {
  return elements.flatMap((el) => (el.name === "w:tc" ? [cell(el, walk)] : WRAPPERS.has(el.name) ? cellsOf(wrapped(el), walk) : []));
}

function blocks(elements: readonly XmlElement[], walk: Walk): BlockNode[] {
  return elements.flatMap((el): BlockNode[] => {
    if (el.name === "w:p") return [paragraph(el, walk)];
    if (el.name === "w:tbl") {
      const tableRows = rows(elementsOf(el), walk);
      return tableRows.length === 0 ? [] : [node("Table", readTableProperties(el, walk.env).options, tableRows)];
    }
    return WRAPPERS.has(el.name) ? blocks(wrapped(el), walk) : [];
  });
}

const rootsOf = (xml: string): XmlElement[] => elementsOf(parseXml(`<fragment>${xml}</fragment>`));

/** The blocks a block-level RawXml shows. */
export function rawBlocks(xml: string): BlockNode[] {
  return blocks(rootsOf(xml), { env: ENV, fields: [] });
}

/** The inline content a paragraph-level RawXml shows. */
export function rawInlines(xml: string): InlineNode[] {
  return inlines(rootsOf(xml), { env: ENV, fields: [] });
}
