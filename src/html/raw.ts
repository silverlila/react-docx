/** What the preview draws for RawXml: the reader keeps content verbatim where no tree kind maps it (content
 *  controls, smart tags, custom XML, simple fields, Word's tables of contents), and Word shows that
 *  content. rawBlocks, rawInlines and rawRunItems read it into the tree kinds resolveDocument draws, with
 *  the reader's own codecs.
 *
 *  - Wrappers (w:sdt, w:smartTag, w:customXml, w:fldSimple, w:ins) are read through; w:del is left out.
 *  - A complex field shows its result and hides its instruction, across paragraphs: a table of contents
 *    is one field whose result is its entries. A page-number field, as the reader recognises one
 *    (pageFieldOf), shows the page's number instead.
 *  - A run is read in order, so a page or column break in it falls between the text before and after.
 *  - A w:sym whose w:char is not hex is left out, as the reader leaves it out of SymbolRun.
 *  - The fragment comes without its package, so a hyperlink to an external target keeps only its text,
 *    pictures, notes and objects are left out, a numbered paragraph draws without its marker (its numId
 *    names no tree list), and theme fonts fall back to the style's. */

import { NO_THEME_ENV } from "../ooxml/codec";
import { readParagraphProperties } from "../ooxml/paragraph";
import { readRunProperties } from "../ooxml/run";
import { readCellProperties, readRowProperties, readTableProperties } from "../ooxml/table";
import { attrOf, childNamed, elementsOf, parseXmlRoots, textOf, type XmlElement } from "../ooxml/xml";
import { pageFieldOf } from "../read/fields";
import { SYMBOL_CHAR } from "../schema/docx-facts";
import type { ChildKind, Node } from "../schema/elements";

type BlockNode = Node<"Paragraph" | "Table">;
type InlineNode = Node<ChildKind<"Paragraph">>;
type RunChild = Node<ChildKind<"TextRun">> | string;

/** A run's content in order: what a TextRun holds, and the breaks and symbols that are runs of their own. A
 *  SymbolRun here carries only its char and font. */
export type RunItem = RunChild | Node<"PageBreak" | "ColumnBreak" | "SymbolRun">;

/** A complex field: its instruction so far, and whether its result is showing. A page-number field's
 *  result is replaced by the page's own number, so its cached result is hidden. */
type Field = { instruction: string; phase: "instruction" | "result" | "replaced" };

/** The open complex fields, outermost first; text shows only when every one of them is in its result. */
type Walk = { readonly fields: Field[] };

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
    const page = pageFieldOf(open.instruction);
    const outer = walk.fields.slice(0, -1).every((field) => field.phase === "result");
    open.phase = page === null ? "result" : "replaced";
    if (page !== null && outer) return node("PageNumber", { field: page });
  } else if (type === "end") {
    walk.fields.pop();
  }
  return null;
}

function runItems(elements: readonly XmlElement[], walk: Walk): RunItem[] {
  const items: RunItem[] = [];
  for (const el of elements) {
    if (el.name === "w:fldChar") {
      const page = fieldChar(el, walk);
      if (page !== null) items.push(page);
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
        items.push(textOf(el));
        break;
      case "w:tab":
        items.push(node("Tab", {}));
        break;
      case "w:br": {
        const type = attrOf(el, "w:type");
        items.push(node(type === "page" ? "PageBreak" : type === "column" ? "ColumnBreak" : "CarriageReturn", {}));
        break;
      }
      case "w:cr":
        items.push(node("CarriageReturn", {}));
        break;
      case "w:noBreakHyphen":
        items.push(node("NoBreakHyphen", {}));
        break;
      case "w:softHyphen":
        items.push(node("SoftHyphen", {}));
        break;
      case "w:lastRenderedPageBreak":
        items.push(node("RawXml", { xml: "<w:lastRenderedPageBreak/>" }));
        break;
      case "w:sym": {
        const char = attrOf(el, "w:char");
        const font = attrOf(el, "w:font");
        if (char !== null && SYMBOL_CHAR.test(char)) items.push(node("SymbolRun", { char, ...(font === null ? {} : { symbolfont: font }) }));
        break;
      }
      default:
        break;
    }
  }
  return items;
}

/** A run as the runs it shows: its content up to each break or symbol is a TextRun with its properties. */
function run(r: XmlElement, walk: Walk): InlineNode[] {
  const props = readRunProperties(childNamed(r, "w:rPr"), NO_THEME_ENV).options;
  const out: InlineNode[] = [];
  let content: RunChild[] = [];
  const flush = () => {
    if (content.length > 0) out.push(node("TextRun", props, content));
    content = [];
  };
  for (const item of runItems(elementsOf(r), walk)) {
    if (typeof item === "string" || (item.type !== "PageBreak" && item.type !== "ColumnBreak" && item.type !== "SymbolRun")) {
      content.push(item);
      continue;
    }
    flush();
    out.push(item.type === "SymbolRun" ? node("SymbolRun", { ...props, ...item.props }) : item);
  }
  flush();
  return out;
}

function inlines(elements: readonly XmlElement[], walk: Walk): InlineNode[] {
  return elements.flatMap((el): InlineNode[] => {
    if (el.name === "w:r") return run(el, walk);
    if (el.name === "w:fldSimple") {
      const page = pageFieldOf(attrOf(el, "w:instr") ?? "");
      if (page === null) return inlines(elementsOf(el), walk);
      if (!showing(walk)) return [];
      const props = readRunProperties(childNamed(childNamed(el, "w:r"), "w:rPr"), NO_THEME_ENV).options;
      return [node("TextRun", props, [node("PageNumber", { field: page })])];
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
  const props = readParagraphProperties(childNamed(p, "w:pPr"), NO_THEME_ENV).options;
  return node("Paragraph", props, inlines(elementsOf(p), walk));
}

function cell(tc: XmlElement, walk: Walk): Node<"TableCell"> {
  const props = readCellProperties(childNamed(tc, "w:tcPr"), NO_THEME_ENV).options;
  const children = blocks(elementsOf(tc), walk);
  return node("TableCell", props, children.length === 0 ? [node("Paragraph", {})] : children);
}

function rows(elements: readonly XmlElement[], walk: Walk): Node<"TableRow">[] {
  return elements.flatMap((el): Node<"TableRow">[] => {
    if (el.name === "w:tr") {
      const props = readRowProperties(childNamed(el, "w:trPr"), NO_THEME_ENV).options;
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
      return tableRows.length === 0 ? [] : [node("Table", readTableProperties(el, NO_THEME_ENV).options, tableRows)];
    }
    return WRAPPERS.has(el.name) ? blocks(wrapped(el), walk) : [];
  });
}

const freshWalk = (): Walk => ({ fields: [] });

/** The blocks a block-level RawXml shows. */
export function rawBlocks(xml: string): BlockNode[] {
  return blocks(parseXmlRoots(xml), freshWalk());
}

/** The inline content a paragraph-level RawXml shows. */
export function rawInlines(xml: string): InlineNode[] {
  return inlines(parseXmlRoots(xml), freshWalk());
}

/** The content a run-level RawXml shows. */
export function rawRunItems(xml: string): RunItem[] {
  return runItems(parseXmlRoots(xml), freshWalk());
}
