/** The body walk: blocks (paragraphs, tables, content controls), inline content (runs, hyperlinks,
 *  bookmarks, fields) and run content, read into author nodes for canonicalize.
 *
 *  - Inline content is read in three steps. Its elements are flattened into items (each child of a w:r
 *    with its run, or another element). Complex fields and bookmark pairs are found over the items. Then
 *    each item becomes a piece: run content of a source w:r, or an inline node. Consecutive run content of
 *    one w:r becomes one TextRun with that run's properties, so a run splits only where OOXML forces it:
 *    page and column breaks, symbols and inline fields. Text breaks stay author `Break`s for canonicalize.
 *  - A page field becomes PageNumber run content of the run holding its instruction, so docx.js's
 *    one-run field reads back into the run it was written in.
 *  - A run's text equal to a PageNumber value ("CURRENT", …) would turn into a PageNumber in
 *    canonicalize, so it is written as the `text` of its own TextRun, which canonicalize keeps literal.
 *  - Bookmarks: an end pairs with the most recent unpaired start of the same w:id in the same parent,
 *    because docx.js writes w:id="1" for every Bookmark. A pair crossing another pair or a field, or one
 *    split across parents, is kept as RawXml with its id moved to 100000 + an ordinal: docx.js's own
 *    Bookmarks all use id 1.
 *  - Word's _GoBack bookmark (the last edit position) is removed up front with `withoutGoBack`.
 *  - The generic fallback (decision 7) keeps an element as RawXml when its slot allows its name and
 *    `rawXmlOf` accepts it, else unwraps a wrapper's content, else drops it.
 *  - OOXML requires a table cell to end with a paragraph; Word always complies, so a cell whose last
 *    block would be RawXml or a Table gets an empty Paragraph without a diagnostic. */

import { readParagraphProperties } from "../ooxml/paragraph";
import { readRunProperties, type RunOptions } from "../ooxml/run";
import { readCellProperties, readRowProperties, readTableProperties } from "../ooxml/table";
import { PAGE_NUMBER_VALUES, RAW_XML_ROOTS } from "../schema/docx-facts";
import type { AuthorNode } from "../tree/author";
import { xmlRoots } from "../tree/xml-roots";
import type { ReadContext } from "./context";
import {
  complexField,
  fieldSpans,
  fldCharType,
  isCheckBox,
  readCheckBox,
  readTableOfContents,
  simpleField,
  type Item,
} from "./fields";
import { attrOf, childNamed, elementsOf, hasRelationship, serializeXml, textOf, type XmlElement } from "./xml";

type Slot = "block" | "inline" | "run";
type Children = readonly (AuthorNode | string)[];

/** Run content of one source w:r, or an inline node that stands between runs. */
type Piece =
  | { readonly kind: "run"; readonly run: XmlElement; readonly value: AuthorNode | string }
  | { readonly kind: "inline"; readonly node: AuthorNode };

/** One inline container's walk: its context and the properties of each run, read once per run. */
type InlineScope = { readonly ctx: ReadContext; runProps(run: XmlElement): RunOptions };

export type RawXmlCheck = { readonly kind: "raw"; readonly xml: string } | { readonly kind: "refused"; readonly reason: string };

export type BlockOptions = {
  /** False where block RawXml cannot stand (footnotes, comments, text boxes). Defaults to true. */
  readonly rawBlocks?: boolean;
  /** The index of the container's first block among its parent's children: a Section's body blocks come
   *  after its Header and Footer children. Defaults to 0. */
  readonly start?: number;
};

export const READ_IN_UNIT_05 = "read in unit 05";
export const READ_IN_UNIT_06 = "read in unit 06";

const PROTECTED_TEXT: readonly string[] = PAGE_NUMBER_VALUES;
const BOOKMARK_ID_BASE = 100000;
const GO_BACK = "_GoBack";
const NOISE = new Set(["w:proofErr", "w:permStart", "w:permEnd"]);
const BLOCK_PARTS = new Set(["w:sectPr", "w:tcPr"]);
const BOOKMARKS = new Set(["w:bookmarkStart", "w:bookmarkEnd"]);

/** Run content that maps to a kind with no props. */
const RUN_KINDS: Readonly<Record<string, string>> = {
  "w:tab": "Tab",
  "w:cr": "CarriageReturn",
  "w:softHyphen": "SoftHyphen",
  "w:noBreakHyphen": "NoBreakHyphen",
  "w:dayShort": "DayShort",
  "w:dayLong": "DayLong",
  "w:monthShort": "MonthShort",
  "w:monthLong": "MonthLong",
  "w:yearShort": "YearShort",
  "w:yearLong": "YearLong",
};

/** Elements a later unit reads, dropped until then. */
const LATER_IN_RUN: Readonly<Record<string, string>> = {
  "w:drawing": READ_IN_UNIT_06,
  "w:pict": READ_IN_UNIT_06,
  "w:object": READ_IN_UNIT_06,
  "w:footnoteReference": READ_IN_UNIT_05,
  "w:endnoteReference": READ_IN_UNIT_05,
  "w:commentReference": READ_IN_UNIT_05,
  "w:annotationRef": READ_IN_UNIT_05,
  "w:footnoteRef": READ_IN_UNIT_05,
  "w:separator": READ_IN_UNIT_05,
  "w:continuationSeparator": READ_IN_UNIT_05,
};

const LATER_INLINE: Readonly<Record<string, string>> = {
  "w:del": READ_IN_UNIT_05,
  "w:moveFrom": READ_IN_UNIT_05,
  "w:commentRangeStart": READ_IN_UNIT_05,
  "w:commentRangeEnd": READ_IN_UNIT_05,
  "m:oMath": READ_IN_UNIT_06,
  "m:oMathPara": READ_IN_UNIT_06,
  "w:pict": READ_IN_UNIT_06,
  "w:object": READ_IN_UNIT_06,
};

/** Wrappers the fallback unwraps: the content it reads in the wrapper's slot. */
const WRAPPED_CONTENT: Readonly<Record<string, (el: XmlElement) => XmlElement[]>> = {
  "w:sdt": (el) => elementsOf(childNamed(el, "w:sdtContent")),
  "w:smartTag": (el) => elementsOf(el).filter((child) => child.name !== "w:smartTagPr"),
  "w:customXml": (el) => elementsOf(el).filter((child) => child.name !== "w:customXmlPr"),
  "mc:AlternateContent": (el) => elementsOf(childNamed(el, "mc:Fallback")),
};

const node = (type: string, props: Readonly<Record<string, unknown>> = {}, children: Children = []): AuthorNode => ({
  type,
  props,
  children,
});

const rawXml = (xml: string): AuthorNode => node("RawXml", { xml });

/** The one gate for every RawXml the reader emits: no r: attribute anywhere, phase 1's xmlRoots accepts the
 *  serialized fragment, and every root is one RAW_XML_ROOTS allows in `slot` (canonicalize would throw
 *  otherwise). */
export function rawXmlOf(elements: readonly XmlElement[], slot: Slot): RawXmlCheck {
  if (elements.some(hasRelationship)) {
    return { kind: "refused", reason: "it carries an r: relationship reference, which docx.js cannot write" };
  }
  const xml = elements.map(serializeXml).join("");
  const roots = xmlRoots(xml);
  if (roots.kind !== "roots") return { kind: "refused", reason: roots.reason };
  const allowed: readonly string[] = RAW_XML_ROOTS[slot];
  const stray = roots.roots.find((root) => !allowed.includes(root));
  return stray === undefined ? { kind: "raw", xml } : { kind: "refused", reason: `it holds <${stray}>, which ${slot} RawXml cannot` };
}

type Fallback =
  | { readonly kind: "raw"; readonly node: AuthorNode }
  | { readonly kind: "content"; readonly elements: readonly XmlElement[] }
  | { readonly kind: "dropped" };

/** Decision 7, reported: RawXml if the slot allows it, else a wrapper's content, else dropped. */
function fallback(el: XmlElement, slot: Slot, ctx: ReadContext, rawAllowed = true): Fallback {
  const roots: readonly string[] = RAW_XML_ROOTS[slot];
  const check = rawAllowed && roots.includes(el.name) ? rawXmlOf([el], slot) : null;
  if (check?.kind === "raw") {
    ctx.report({ kind: "raw", element: el.name, detail: "no tree kind maps it, so it is kept verbatim" });
    return { kind: "raw", node: rawXml(check.xml) };
  }
  const why = check === null ? "no tree kind maps it" : check.reason;
  const unwrap = Object.prototype.hasOwnProperty.call(WRAPPED_CONTENT, el.name) ? WRAPPED_CONTENT[el.name] : null;
  if (unwrap !== null) {
    ctx.report({ kind: "dropped", element: el.name, detail: `${why}; its content is read without it` });
    return { kind: "content", elements: unwrap(el) };
  }
  ctx.report({ kind: "dropped", element: el.name, detail: why });
  return { kind: "dropped" };
}

/** Removes Word's _GoBack bookmark (start and end, anywhere in the part), counting it ignored. */
export function withoutGoBack(root: XmlElement, ctx: ReadContext): XmlElement {
  const ids = new Set<string>();
  const collect = (el: XmlElement): void => {
    if (el.name === "w:bookmarkStart" && attrOf(el, "w:name") === GO_BACK) ids.add(attrOf(el, "w:id") ?? "");
    elementsOf(el).forEach(collect);
  };
  collect(root);
  if (ids.size === 0) return root;
  ids.forEach(() => ctx.ignore(GO_BACK));
  const strip = (el: XmlElement): XmlElement => ({
    ...el,
    children: el.children.flatMap((child): (XmlElement | string)[] => {
      if (typeof child === "string") return [child];
      if (BOOKMARKS.has(child.name) && ids.has(attrOf(child, "w:id") ?? "")) return [];
      return [strip(child)];
    }),
  });
  return strip(root);
}

/** A bookmark start or end with its w:id moved past docx.js's own bookmark ids: the same source id in one
 *  part always gets the same new id, wherever its start and end are kept. */
function renumberedBookmark(el: XmlElement, ctx: ReadContext): XmlElement {
  const id = BOOKMARK_ID_BASE + ctx.ordinals.next("bookmark", `${ctx.part}#${attrOf(el, "w:id") ?? ""}`);
  return { ...el, attributes: { ...el.attributes, "w:id": String(id) } };
}

/** A bookmark start or end kept as RawXml, renumbered. */
function rawBookmark(el: XmlElement, slot: Slot, ctx: ReadContext): AuthorNode | null {
  const check = rawXmlOf([renumberedBookmark(el, ctx)], slot);
  if (check.kind === "refused") {
    ctx.report({ kind: "dropped", element: el.name, detail: check.reason });
    return null;
  }
  ctx.report({ kind: "raw", element: el.name, detail: "its bookmark does not open and close in one parent" });
  return rawXml(check.xml);
}

// Blocks

export function readBlocks(container: XmlElement, ctx: ReadContext, options: BlockOptions = {}): AuthorNode[] {
  const blocks: AuthorNode[] = [];
  const list: BlockList = {
    rawBlocks: options.rawBlocks ?? true,
    inSection: container.name === "w:body",
    start: options.start ?? 0,
    blocks,
  };
  readBlockElements(elementsOf(container), ctx, list);
  return blocks;
}

type BlockList = {
  readonly rawBlocks: boolean;
  /** A Section body (document.ts reads each section's blocks from a w:body), where TableOfContents may stand. */
  readonly inSection: boolean;
  readonly start: number;
  readonly blocks: AuthorNode[];
};

function readBlockElements(elements: readonly XmlElement[], ctx: ReadContext, list: BlockList): void {
  for (const el of elements) {
    const here = ctx.within(null, [...ctx.at, list.start + list.blocks.length]);
    const toc = el.name === "w:sdt" && list.inSection ? readTableOfContents(el) : null;
    if (BLOCK_PARTS.has(el.name)) continue;
    if (NOISE.has(el.name)) {
      ctx.ignore(el.name);
    } else if (el.name === "w:p") {
      list.blocks.push(readParagraph(el, here));
    } else if (el.name === "w:tbl") {
      list.blocks.push(readTable(el, here));
    } else if (toc !== null) {
      list.blocks.push(toc);
    } else if (BOOKMARKS.has(el.name) && list.rawBlocks) {
      const raw = rawBookmark(el, "block", here);
      if (raw !== null) list.blocks.push(raw);
    } else if (el.name === "w:altChunk") {
      here.report({ kind: "dropped", element: el.name, detail: "it imports another part through r:id, which docx.js cannot write" });
    } else {
      const read = fallback(el, "block", here, list.rawBlocks);
      if (read.kind === "raw") list.blocks.push(read.node);
      else if (read.kind === "content") readBlockElements(read.elements, ctx, list);
    }
  }
}

function readParagraph(p: XmlElement, ctx: ReadContext): AuthorNode {
  const read = readParagraphProperties(childNamed(p, "w:pPr"), ctx.env);
  ctx.notes(read.notes);
  if (read.numPr !== null) ctx.report({ kind: "dropped", element: "w:numPr", detail: READ_IN_UNIT_05 });
  if (read.sectPr !== null) {
    ctx.report({ kind: "dropped", element: "w:sectPr", detail: "only a paragraph in the document body ends a section" });
  }
  return node("Paragraph", read.options, readInline(elementsOf(p).filter((el) => el.name !== "w:pPr"), ctx));
}

// Tables

type TableLevel = {
  readonly child: string;
  readonly own: ReadonlySet<string>;
  readonly read: (el: XmlElement, ctx: ReadContext) => AuthorNode;
  readonly holds: string;
};

const ROWS: TableLevel = { child: "w:tr", own: new Set(["w:tblPr", "w:tblGrid"]), read: readRow, holds: "rows" };
const CELLS: TableLevel = { child: "w:tc", own: new Set(["w:trPr"]), read: readCell, holds: "cells" };
const TABLE_DROPPED: Readonly<Record<string, string>> = {
  "w:tblPrEx": "docx.js has no table property exceptions option",
};

/** The rows of a w:tbl or the cells of a w:tr. Rows and cells cannot be RawXml, so wrappers are unwrapped. */
function readTableLevel(elements: readonly XmlElement[], ctx: ReadContext, level: TableLevel, out: AuthorNode[]): AuthorNode[] {
  for (const el of elements) {
    if (level.own.has(el.name)) continue;
    if (el.name === level.child) {
      out.push(level.read(el, ctx.within(null, [...ctx.at, out.length])));
    } else if (NOISE.has(el.name)) {
      ctx.ignore(el.name);
    } else if (el.name === "w:sdt" || el.name === "w:customXml") {
      ctx.report({ kind: "dropped", element: el.name, detail: `a table's ${level.holds} cannot be RawXml; its content is read without it` });
      readTableLevel(WRAPPED_CONTENT[el.name](el), ctx, level, out);
    } else {
      const detail = Object.prototype.hasOwnProperty.call(TABLE_DROPPED, el.name)
        ? TABLE_DROPPED[el.name]
        : `this level of a table holds only ${level.holds}`;
      ctx.report({ kind: "dropped", element: el.name, detail });
    }
  }
  return out;
}

function readTable(tbl: XmlElement, ctx: ReadContext): AuthorNode {
  const read = readTableProperties(tbl, ctx.env);
  ctx.notes(read.notes);
  return node("Table", read.options, readTableLevel(elementsOf(tbl), ctx, ROWS, []));
}

function readRow(tr: XmlElement, ctx: ReadContext): AuthorNode {
  const read = readRowProperties(childNamed(tr, "w:trPr"), ctx.env);
  ctx.notes(read.notes);
  return node("TableRow", read.options, readTableLevel(elementsOf(tr), ctx, CELLS, []));
}

function readCell(tc: XmlElement, ctx: ReadContext): AuthorNode {
  const read = readCellProperties(childNamed(tc, "w:tcPr"), ctx.env);
  ctx.notes(read.notes);
  const blocks = readBlocks(tc, ctx);
  const last = blocks[blocks.length - 1];
  const endsWithParagraph = last === undefined || (last.type !== "RawXml" && last.type !== "Table");
  return node("TableCell", read.options, endsWithParagraph ? blocks : [...blocks, node("Paragraph")]);
}

// Inline content

/** The inline children of a w:p, w:hyperlink or other inline container. */
export function readInline(elements: readonly XmlElement[], ctx: ReadContext): AuthorNode[] {
  const props = new Map<XmlElement, RunOptions>();
  const scope: InlineScope = {
    ctx,
    runProps(run) {
      const known = props.get(run);
      if (known !== undefined) return known;
      const read = readRunProperties(childNamed(run, "w:rPr"), ctx.env);
      ctx.notes(read.notes);
      props.set(run, read.options);
      return read.options;
    },
  };
  return grouped(piecesOf(itemsOf(elements), scope), scope);
}

function itemsOf(elements: readonly XmlElement[]): Item[] {
  return elements.flatMap((el): Item[] =>
    el.name === "w:r"
      ? elementsOf(el)
          .filter((child) => child.name !== "w:rPr")
          .map((child) => ({ kind: "atom", run: el, el: child }))
      : [{ kind: "element", el }]
  );
}

/** Start index → end index of each bookmark that opens and closes in `items`, nesting properly, outside the
 *  field spans. */
function bookmarkPairs(items: readonly Item[], inField: (index: number) => boolean): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: { readonly index: number; readonly id: string | null }[] = [];
  items.forEach((item, index) => {
    if (item.kind !== "element" || inField(index)) return;
    const id = attrOf(item.el, "w:id");
    if (item.el.name === "w:bookmarkStart" && attrOf(item.el, "w:name") !== null) {
      open.push({ index, id });
    } else if (item.el.name === "w:bookmarkEnd") {
      let match = open.length - 1;
      while (match >= 0 && open[match].id !== id) match -= 1;
      if (match < 0) return;
      pairs.set(open[match].index, index);
      open.length = match;
    }
  });
  return pairs;
}

function piecesOf(items: readonly Item[], scope: InlineScope): Piece[] {
  const { spans, unclosed } = fieldSpans(items);
  const fieldOf = new Map<number, number>();
  spans.forEach((end, begin) => {
    for (let i = begin; i <= end; i++) fieldOf.set(i, begin);
  });
  const pairs = bookmarkPairs(items, (index) => fieldOf.has(index));
  const pieces: Piece[] = [];
  let strayReported = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const spanEnd = spans.get(i);
    const pairEnd = pairs.get(i);
    if (spanEnd !== undefined) {
      pieces.push(...fieldPieces(items.slice(i, spanEnd + 1), scope));
      i = spanEnd;
    } else if (pairEnd !== undefined) {
      const children = grouped(piecesOf(items.slice(i + 1, pairEnd), scope), scope);
      pieces.push({ kind: "inline", node: node("Bookmark", { id: attrOf(item.el, "w:name") }, children) });
      i = pairEnd;
    } else if (unclosed.has(i)) {
      scope.ctx.report({
        kind: "dropped",
        element: "w:fldChar",
        detail: "the field does not end in this paragraph; its code is dropped and its result kept as text",
      });
      strayReported = true;
    } else if (item.kind === "atom" && (item.el.name === "w:instrText" || fldCharType(item) !== null)) {
      if (!strayReported) {
        scope.ctx.report({ kind: "dropped", element: item.el.name, detail: "part of a field that begins in another paragraph" });
        strayReported = true;
      }
    } else if (item.kind === "atom") {
      pieces.push(...atomPieces(item.run, item.el, scope));
    } else {
      pieces.push(...elementPieces(item.el, scope));
    }
  }
  return pieces;
}

const inline = (nodes: readonly AuthorNode[]): Piece[] => nodes.map((value) => ({ kind: "inline", node: value }));

function fieldPieces(span: readonly Item[], scope: InlineScope): Piece[] {
  const field = complexField(span);
  switch (field.kind) {
    case "page":
      if (field.cached) scope.ctx.ignore("w:fldChar");
      return [{ kind: "run", run: field.run, value: node("PageNumber", { field: field.field }) }];
    case "node":
      return inline([field.node]);
    case "other": {
      const raw = field.raw.map((el) => (BOOKMARKS.has(el.name) ? renumberedBookmark(el, scope.ctx) : el));
      const check = rawXmlOf(raw, "inline");
      if (check.kind === "raw") {
        scope.ctx.report({ kind: "raw", element: "w:fldChar", detail: "a field no tree kind maps, kept verbatim with its result" });
        return inline([rawXml(check.xml)]);
      }
      scope.ctx.report({ kind: "dropped", element: "w:fldChar", detail: `the field code: ${check.reason}; its result is kept as text` });
      return piecesOf(field.result, scope);
    }
    default: {
      const exhaustive: never = field;
      throw new Error(`fieldPieces: unknown field ${JSON.stringify(exhaustive)}`);
    }
  }
}

function elementPieces(el: XmlElement, scope: InlineScope): Piece[] {
  const { ctx } = scope;
  if (NOISE.has(el.name)) {
    ctx.ignore(el.name);
    return [];
  }
  if (Object.prototype.hasOwnProperty.call(LATER_INLINE, el.name)) {
    ctx.report({ kind: "dropped", element: el.name, detail: LATER_INLINE[el.name] });
    return [];
  }
  switch (el.name) {
    case "w:hyperlink":
      return hyperlinkPieces(el, ctx);
    case "w:fldSimple":
      return simpleFieldPieces(el, ctx);
    case "w:bookmarkStart":
    case "w:bookmarkEnd": {
      const raw = rawBookmark(el, "inline", ctx);
      return raw === null ? [] : inline([raw]);
    }
    case "w:ins":
    case "w:moveTo":
      ctx.report({ kind: "dropped", element: el.name, detail: `${READ_IN_UNIT_05}; its content is kept as plain text` });
      return inline(readInline(elementsOf(el), ctx));
    case "w:sdt":
      if (isCheckBox(el)) return inline([readCheckBox(el, ctx)]);
      return fallbackPieces(el, ctx);
    default:
      return fallbackPieces(el, ctx);
  }
}

function fallbackPieces(el: XmlElement, ctx: ReadContext): Piece[] {
  const read = fallback(el, "inline", ctx);
  if (read.kind === "raw") return inline([read.node]);
  return read.kind === "content" ? inline(readInline(read.elements, ctx)) : [];
}

const HYPERLINK_ATTRIBUTES = new Set(["r:id", "w:anchor", "w:history"]);

function hyperlinkPieces(el: XmlElement, ctx: ReadContext): Piece[] {
  for (const name of Object.keys(el.attributes)) {
    if (!HYPERLINK_ATTRIBUTES.has(name)) {
      ctx.report({ kind: "dropped", element: "w:hyperlink", detail: `${name}="${el.attributes[name]}": docx.js has no option for it` });
    }
  }
  if (attrOf(el, "w:history") !== null) ctx.ignore("w:history");
  const children = readInline(elementsOf(el), ctx);
  const relId = attrOf(el, "r:id");
  const anchor = attrOf(el, "w:anchor");
  if (relId !== null) {
    const rel = ctx.pkg.relsOf(ctx.part).get(relId);
    if (rel !== undefined) {
      return inline([node("ExternalHyperlink", { link: anchor === null ? rel.target : `${rel.target}#${anchor}` }, children)]);
    }
    ctx.report({ kind: "dropped", element: "w:hyperlink", detail: `r:id="${relId}" has no relationship; its content is kept` });
    return inline(children);
  }
  if (anchor !== null) return inline([node("InternalHyperlink", { anchor }, children)]);
  ctx.report({ kind: "dropped", element: "w:hyperlink", detail: "it has no target; its content is kept" });
  return inline(children);
}

function simpleFieldPieces(el: XmlElement, ctx: ReadContext): Piece[] {
  const read = simpleField(el);
  switch (read.kind) {
    case "page":
      if (read.cached) ctx.ignore("w:fldSimple");
      return [
        {
          kind: "run",
          run: read.run ?? { name: "w:r", attributes: {}, children: [] },
          value: node("PageNumber", { field: read.field }),
        },
      ];
    case "node":
      return inline([read.node]);
    case "other": {
      const check = rawXmlOf([el], "inline");
      if (check.kind === "raw") {
        ctx.report({ kind: "raw", element: el.name, detail: "a field no tree kind maps, kept verbatim with its result" });
        return inline([rawXml(check.xml)]);
      }
      ctx.report({ kind: "dropped", element: el.name, detail: `${check.reason}; its result is kept as text` });
      return inline(readInline(elementsOf(el), ctx));
    }
    default: {
      const exhaustive: never = read;
      throw new Error(`simpleFieldPieces: unknown field ${JSON.stringify(exhaustive)}`);
    }
  }
}

// Run content

const POSITIONAL_TAB = {
  "w:alignment": ["left", "center", "right"],
  "w:relativeTo": ["margin", "indent"],
  "w:leader": ["none", "dot", "hyphen", "underscore", "middleDot"],
} as const;

/** w:ptab → PositionalTab, or null when an attribute docx.js requires is missing or not one it accepts. */
function positionalTab(el: XmlElement): AuthorNode | null {
  const props: Record<string, string> = {};
  for (const [attribute, values] of Object.entries(POSITIONAL_TAB)) {
    const value = attrOf(el, attribute);
    const accepted: readonly string[] = values;
    if (value === null || !accepted.includes(value)) return null;
    props[attribute.slice(2)] = value;
  }
  return node("PositionalTab", props);
}

function runFallbackPieces(run: XmlElement, el: XmlElement, scope: InlineScope): Piece[] {
  const read = fallback(el, "run", scope.ctx);
  if (read.kind === "raw") return [{ kind: "run", run, value: read.node }];
  return read.kind === "content" ? read.elements.flatMap((child) => atomPieces(run, child, scope)) : [];
}

function atomPieces(run: XmlElement, el: XmlElement, scope: InlineScope): Piece[] {
  const { ctx } = scope;
  const content = (value: AuthorNode | string): Piece[] => [{ kind: "run", run, value }];
  if (Object.prototype.hasOwnProperty.call(RUN_KINDS, el.name)) return content(node(RUN_KINDS[el.name]));
  if (Object.prototype.hasOwnProperty.call(LATER_IN_RUN, el.name)) {
    ctx.report({ kind: "dropped", element: el.name, detail: LATER_IN_RUN[el.name] });
    return [];
  }
  switch (el.name) {
    case "w:t": {
      const text = textOf(el);
      return text === "" ? [] : content(text);
    }
    case "w:br":
      return breakPieces(run, el, scope);
    case "w:ptab": {
      const tab = positionalTab(el);
      return tab === null ? runFallbackPieces(run, el, scope) : content(tab);
    }
    case "w:sym": {
      const char = attrOf(el, "w:char");
      if (char === null) return runFallbackPieces(run, el, scope);
      const font = attrOf(el, "w:font");
      const props = { ...scope.runProps(run), char, ...(font === null ? {} : { symbolfont: font }) };
      return inline([node("SymbolRun", props)]);
    }
    case "w:lastRenderedPageBreak":
      ctx.ignore(el.name);
      return [];
    default:
      return runFallbackPieces(run, el, scope);
  }
}

function breakPieces(run: XmlElement, el: XmlElement, scope: InlineScope): Piece[] {
  const clear = attrOf(el, "w:clear");
  if (clear !== null) scope.ctx.report({ kind: "dropped", element: "w:br", detail: `w:clear="${clear}": docx.js has no option for it` });
  switch (attrOf(el, "w:type")) {
    case null:
    case "textWrapping":
      return [{ kind: "run", run, value: node("Break") }];
    case "page":
      return inline([node("PageBreak")]);
    case "column":
      return inline([node("ColumnBreak")]);
    default:
      return runFallbackPieces(run, el, scope);
  }
}

// Grouping pieces into runs

function mergeStrings(children: Children): (AuthorNode | string)[] {
  const merged: (AuthorNode | string)[] = [];
  for (const child of children) {
    const last = merged[merged.length - 1];
    if (typeof child === "string" && typeof last === "string") merged[merged.length - 1] = last + child;
    else merged.push(child);
  }
  return merged;
}

/** One TextRun, split around any text canonicalize would read as a PageNumber value. */
function textRuns(props: RunOptions, children: Children): AuthorNode[] {
  const runs: AuthorNode[] = [];
  let current: (AuthorNode | string)[] = [];
  for (const child of mergeStrings(children)) {
    if (typeof child !== "string" || !PROTECTED_TEXT.includes(child)) {
      current.push(child);
      continue;
    }
    if (current.length > 0) runs.push(node("TextRun", props, current));
    current = [];
    runs.push(node("TextRun", { ...props, text: child }));
  }
  if (current.length > 0) runs.push(node("TextRun", props, current));
  return runs;
}

/** Consecutive run content of one w:r becomes one TextRun; inline nodes stand between. */
function grouped(pieces: readonly Piece[], scope: InlineScope): AuthorNode[] {
  const out: AuthorNode[] = [];
  let run: XmlElement | null = null;
  let content: (AuthorNode | string)[] = [];
  const flush = () => {
    if (run !== null) out.push(...textRuns(scope.runProps(run), content));
    run = null;
    content = [];
  };
  for (const piece of pieces) {
    if (piece.kind === "inline") {
      flush();
      out.push(piece.node);
      continue;
    }
    if (piece.run !== run) flush();
    run = piece.run;
    content.push(piece.value);
  }
  flush();
  return out;
}
