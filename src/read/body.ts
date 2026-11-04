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
 *  - Text equal to a PageNumber value ("CURRENT", …) is kept as its own TextRun's `text`, so canonicalize does not read it as a PageNumber.
 *  - Bookmarks: an end pairs with the most recent unpaired start of the same w:id in the same parent,
 *    because docx.js writes w:id="1" for every Bookmark. A pair crossing another pair or a field, or one
 *    split across parents, is kept as RawXml with its id moved to 100000 + an ordinal.
 *  - Word's _GoBack bookmark (the last edit position) is removed up front with `withoutGoBack`.
 *  - The generic fallback keeps an element as RawXml when its slot allows its name and
 *    `rawXmlOf` accepts it, else unwraps a wrapper's content, else drops it. Every RawXml names a renamed
 *    style (`clashingStyleIds`) by its fresh id.
 *  - OOXML requires a table cell to end with a paragraph; Word always complies, so a cell whose last
 *    block would be RawXml or a Table gets an empty Paragraph without a diagnostic.
 *  - The walk reads the body, headers and footers, footnotes and comments, told apart by the context's
 *    part. docx.js registers numbering and writes footnote references only for the main part, so a
 *    numbered paragraph elsewhere gets its marker as leading text, and a footnote reference
 *    elsewhere is dropped. docx.js writes the footnote-reference run's style itself.
 *  - A paragraph with a list but no w:pStyle gets `custom: true`, because docx.js adds pStyle ListParagraph
 *    to a numbered paragraph otherwise.
 *  - docx.js writes a Textbox as its own paragraph, so a VML text box that is a paragraph's only content
 *    (directly in the w:p, as docx.js writes it, or in its only run, as Word does) makes that paragraph a
 *    Textbox, in a Section body only. A text box anywhere else is dropped.
 *  - mc:AlternateContent is read as its first Choice whose elements all map to a kind other than RawXml in
 *    the slot (`mapsToKind`), else as its Fallback. */

import type * as docx from "docx";
import { isOneOf, type Note } from "../ooxml/codec";
import { readParagraphProperties, type ParagraphOptions, type ParagraphRead } from "../ooxml/paragraph";
import { readRunProperties, type RunOptions } from "../ooxml/run";
import { withRenamedStyles } from "../ooxml/style";
import { readCellProperties, readRowProperties, readTableProperties } from "../ooxml/table";
import { PAGE_NUMBER_VALUES, RAW_XML_ROOTS, SYMBOL_CHAR } from "../schema/docx-facts";
import { isOwnKey, own } from "../schema/own";
import type { AuthorNode } from "../tree/author";
import { mergeStrings } from "../tree/canonical";
import { xmlRoots } from "../tree/xml-roots";
import { MOVE_RANGES, isChange, isDeletion, trackedRuns } from "./changes";
import type { ReadContext } from "./context";
import type { TreePath } from "./diagnostics";
import { footnoteNode, type NotesReader } from "./notes";
import { numberingOption, unknownNumId, type NumberingReader } from "./numbering";
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
import { parseDrawing, parseVmlImage, readDrawing, readPicture } from "./images";
import { isPlainMath, readMath } from "./math";
import { alternateContent, textBoxOf, textBoxStyle, type TextBox } from "./objects";
import { attrOf, childNamed, elementsOf, serializeXml, textOf, type XmlElement } from "../ooxml/xml";

type Slot = "block" | "inline" | "run";
type Children = readonly (AuthorNode | string)[];

type Piece =
  | { readonly kind: "run"; readonly run: XmlElement; readonly value: AuthorNode | string }
  | { readonly kind: "inline"; readonly node: AuthorNode };

type BodyParts = { readonly numbering: NumberingReader; readonly notes: NotesReader };

export type BodyContext = Omit<ReadContext, "within"> & {
  readonly parts: BodyParts;
  within(part: string | null, at: TreePath): BodyContext;
};

export function bodyContext(ctx: ReadContext, parts: BodyParts): BodyContext {
  return { ...ctx, parts, within: (part, at) => bodyContext(ctx.within(part, at), parts) };
}

type InlineMode = "live" | "deleted";

type InlineScope = { readonly ctx: BodyContext; readonly mode: InlineMode; runProps(run: XmlElement): RunOptions };

type RawXmlCheck = { readonly kind: "raw"; readonly xml: string } | { readonly kind: "refused"; readonly reason: string };

type BlockOptions = {
  readonly rawBlocks?: boolean;
  readonly start?: number;
  readonly tables?: boolean;
};

const PROTECTED_TEXT: readonly string[] = PAGE_NUMBER_VALUES;
const BOOKMARK_ID_BASE = 100000;
const GO_BACK = "_GoBack";
const NOISE = new Set(["w:proofErr", "w:permStart", "w:permEnd"]);
const BLOCK_PARTS = new Set(["w:sectPr", "w:tcPr"]);
const BOOKMARKS = new Set(["w:bookmarkStart", "w:bookmarkEnd"]);

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

const MAPPED_RUN_CONTENT = new Set([...Object.keys(RUN_KINDS), "w:t", "w:br", "w:sym", "w:ptab"]);

const HEADINGS = ["Title", "Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"] as const satisfies readonly (typeof docx.HeadingLevel)[keyof typeof docx.HeadingLevel][];

const DROPPED_IN_RUN: Readonly<Record<string, string>> = {
  "w:endnoteReference": "docx.js cannot write endnotes",
  "w:footnoteRef": "docx.js writes a footnote's number mark only at its start",
  "w:separator": "only a separator footnote, which docx.js writes itself, holds it",
  "w:continuationSeparator": "only a separator footnote, which docx.js writes itself, holds it",
};

const WRAPPED_CONTENT: Readonly<Record<string, (el: XmlElement) => XmlElement[]>> = {
  "w:sdt": (el) => elementsOf(childNamed(el, "w:sdtContent")),
  "w:smartTag": (el) => elementsOf(el).filter((child) => child.name !== "w:smartTagPr"),
  "w:customXml": (el) => elementsOf(el).filter((child) => child.name !== "w:customXmlPr"),
};

const node = (type: string, props: Readonly<Record<string, unknown>> = {}, children: Children = []): AuthorNode => ({
  type,
  props,
  children,
});

const rawXml = (xml: string): AuthorNode => node("RawXml", { xml });

function rawXmlOf(elements: readonly XmlElement[], slot: Slot, ctx: ReadContext): RawXmlCheck {
  const xml = elements.map((el) => serializeXml(withRenamedStyles(el, ctx.env.styleIds))).join("");
  const roots = xmlRoots(xml);
  if (roots.kind === "relationship") {
    return { kind: "refused", reason: "it carries an r: relationship reference, which docx.js cannot write" };
  }
  if (roots.kind !== "roots") return { kind: "refused", reason: roots.reason };
  const allowed: readonly string[] = RAW_XML_ROOTS[slot];
  const stray = roots.roots.find((root) => !allowed.includes(root));
  return stray === undefined ? { kind: "raw", xml } : { kind: "refused", reason: `it holds <${stray}>, which ${slot} RawXml cannot` };
}

type Fallback =
  | { readonly kind: "raw"; readonly node: AuthorNode }
  | { readonly kind: "content"; readonly elements: readonly XmlElement[] }
  | { readonly kind: "dropped" };

function fallback(el: XmlElement, slot: Slot, ctx: ReadContext, rawAllowed = true): Fallback {
  const roots: readonly string[] = RAW_XML_ROOTS[slot];
  const check = rawAllowed && roots.includes(el.name) ? rawXmlOf([el], slot, ctx) : null;
  if (check?.kind === "raw") {
    ctx.report({ kind: "raw", element: el.name, detail: "no tree kind maps it, so it is kept verbatim" });
    return { kind: "raw", node: rawXml(check.xml) };
  }
  const why = check === null ? "no tree kind maps it" : check.reason;
  const unwrap = own(WRAPPED_CONTENT, el.name) ?? null;
  if (unwrap !== null) {
    ctx.report({ kind: "dropped", element: el.name, detail: `${why}; its content is read without it` });
    return { kind: "content", elements: unwrap(el) };
  }
  ctx.report({ kind: "dropped", element: el.name, detail: why });
  return { kind: "dropped" };
}

function mapsToKind(el: XmlElement, slot: Slot, ctx: ReadContext): boolean {
  switch (slot) {
    case "block":
      return el.name === "w:p" || el.name === "w:tbl";
    case "inline":
      if (el.name === "m:oMath") return isPlainMath(el);
      return el.name === "w:r" && elementsOf(el).every((child) => child.name === "w:rPr" || mapsToKind(child, "run", ctx));
    case "run":
      if (el.name === "w:drawing") return parseDrawing(el, ctx).kind === "image";
      if (el.name === "w:pict") return parseVmlImage(el, ctx)?.kind === "image";
      return MAPPED_RUN_CONTENT.has(el.name);
    default: {
      const exhaustive: never = slot;
      throw new Error(`mapsToKind: unknown slot ${JSON.stringify(exhaustive)}`);
    }
  }
}

function alternateElements(el: XmlElement, slot: Slot, ctx: ReadContext): readonly XmlElement[] {
  const chosen = alternateContent(el, (child) => mapsToKind(child, slot, ctx));
  if (chosen === null) {
    ctx.report({ kind: "dropped", element: el.name, detail: "its Choice holds content no tree kind maps, and it has no Fallback content" });
    return [];
  }
  ctx.report({ kind: "resolved", element: el.name, detail: `alternate content: used ${chosen.used}` });
  return chosen.elements;
}

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

function renumberedBookmark(el: XmlElement, ctx: ReadContext): XmlElement {
  const id = BOOKMARK_ID_BASE + ctx.ordinals("bookmark", `${ctx.part}#${attrOf(el, "w:id") ?? ""}`);
  return { ...el, attributes: { ...el.attributes, "w:id": String(id) } };
}

function rawBookmark(el: XmlElement, slot: Slot, ctx: ReadContext): AuthorNode | null {
  const check = rawXmlOf([renumberedBookmark(el, ctx)], slot, ctx);
  if (check.kind === "refused") {
    ctx.report({ kind: "dropped", element: el.name, detail: check.reason });
    return null;
  }
  ctx.report({ kind: "raw", element: el.name, detail: "its bookmark does not open and close in one parent" });
  return rawXml(check.xml);
}

export function readBlocks(container: XmlElement, ctx: BodyContext, options: BlockOptions = {}): AuthorNode[] {
  const blocks: AuthorNode[] = [];
  const list: BlockList = {
    rawBlocks: options.rawBlocks ?? true,
    inSection: container.name === "w:body",
    start: options.start ?? 0,
    tables: options.tables ?? true,
    blocks,
  };
  readBlockElements(elementsOf(container), ctx, list);
  return blocks;
}

type BlockList = {
  readonly rawBlocks: boolean;
  readonly inSection: boolean;
  readonly start: number;
  readonly tables: boolean;
  readonly blocks: AuthorNode[];
};

function readBlockElements(elements: readonly XmlElement[], ctx: BodyContext, list: BlockList): void {
  for (const el of elements) {
    const here = ctx.within(null, [...ctx.at, list.start + list.blocks.length]);
    const toc = el.name === "w:sdt" && list.inSection ? readTableOfContents(el) : null;
    if (BLOCK_PARTS.has(el.name)) continue;
    if (NOISE.has(el.name) || MOVE_RANGES.has(el.name)) {
      ctx.ignore(el.name);
    } else if (el.name === "w:p") {
      const base = list.start + list.blocks.length;
      list.blocks.push(...readParagraph(el, (offset) => ctx.within(null, [...ctx.at, base + offset]), list.inSection));
    } else if (el.name === "w:tbl" && list.tables) {
      list.blocks.push(readTable(el, here));
    } else if (el.name === "w:tbl") {
      here.report({ kind: "dropped", element: el.name, detail: "table in a text box, which holds only Paragraphs" });
    } else if (el.name === "mc:AlternateContent") {
      readBlockElements(alternateElements(el, "block", here), ctx, list);
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

/** A paragraph, after the text boxes it holds beside other content (Word's anchored text boxes): docx.js
 *  writes a Textbox as a paragraph of its own, so each becomes a Textbox before the paragraph, in a Section
 *  body only. */
function readParagraph(p: XmlElement, at: (offset: number) => BodyContext, inSection: boolean): AuthorNode[] {
  const all = elementsOf(p).filter((el) => el.name !== "w:pPr");
  const ctx = at(0);
  if (!inSection || loneTextBox(all, ctx) !== null) return [readOneParagraph(p, all, ctx, inSection)];
  const hoisted = hoistTextBoxes(all, ctx);
  const boxes = hoisted.boxes.map((box, i) => hoistedTextbox(box, at(i)));
  return [...boxes, readOneParagraph(p, hoisted.content, at(boxes.length), inSection)];
}

/** The text boxes in `content`'s runs, directly or as alternate content's Fallback, and `content`
 *  without them. */
function hoistTextBoxes(content: readonly XmlElement[], ctx: BodyContext): { boxes: TextBox[]; content: XmlElement[] } {
  const boxes: TextBox[] = [];
  const boxIn = (el: XmlElement): TextBox | null => {
    if (el.name === "w:pict") return textBoxOf(el);
    if (el.name !== "mc:AlternateContent") return null;
    const chosen = alternateContent(el, (x) => mapsToKind(x, "run", ctx));
    const [pict, ...rest] = chosen?.used === "Fallback" ? chosen.elements : [];
    return pict?.name === "w:pict" && rest.length === 0 ? textBoxOf(pict) : null;
  };
  const out = content.flatMap((el): XmlElement[] => {
    if (el.name === "w:pict") {
      const box = textBoxOf(el);
      if (box === null) return [el];
      boxes.push(box);
      return [];
    }
    if (el.name !== "w:r") return [el];
    const kept = el.children.filter((child) => {
      const box = typeof child === "string" ? null : boxIn(child);
      if (box !== null) boxes.push(box);
      return box === null;
    });
    if (kept.length === el.children.length) return [el];
    const rest = kept.filter((child) => typeof child !== "string" && child.name !== "w:rPr");
    return rest.length === 0 ? [] : [{ ...el, children: kept }];
  });
  return { boxes, content: out };
}

function hoistedTextbox(box: TextBox, ctx: BodyContext): AuthorNode {
  ctx.report({ kind: "resolved", element: "w:pict", detail: "a text box beside other content: read as a Textbox before its paragraph" });
  const notes: Note[] = [];
  const style = textBoxStyle(box, notes);
  ctx.notes(notes);
  return node("Textbox", style === undefined ? {} : { style }, readBlocks(box.content, ctx, { rawBlocks: false, tables: false }));
}

function readOneParagraph(p: XmlElement, all: readonly XmlElement[], ctx: BodyContext, inSection: boolean): AuthorNode {
  const read = readParagraphProperties(childNamed(p, "w:pPr"), ctx.env);
  ctx.notes(read.notes);
  if (read.sectPr !== null) {
    ctx.report({ kind: "dropped", element: "w:sectPr", detail: "only a paragraph in the document body ends a section" });
  }
  const lone = loneTextBox(all, ctx);
  if (lone !== null && inSection) return textboxNode(read, lone, ctx);
  if (lone !== null) {
    ctx.report({ kind: "dropped", element: "w:pict", detail: "a text box outside a Section body: Textbox stands only in a Section" });
  }
  const content = lone === null ? all : all.filter((el) => el !== lone.holder);
  const { numPr } = read;
  if (numPr !== null && numPr.numId !== "0" && ctx.part !== ctx.pkg.mainPart) {
    return markedParagraph(read.options, numPr, content, ctx);
  }
  const numbering =
    numPr === null ? null : numberingOption(numPr, { custom: read.options.style === undefined }, ctx.parts.numbering, ctx);
  const props = numbering === null ? read.options : { ...read.options, numbering };
  return node("Paragraph", props, readInline(content, ctx));
}

function markedParagraph(
  options: ParagraphOptions,
  numPr: NonNullable<ParagraphRead["numPr"]>,
  content: readonly XmlElement[],
  ctx: BodyContext
): AuthorNode {
  const marker = ctx.parts.numbering.markerOf(numPr.numId, numPr.level, ctx);
  if (marker === null) {
    ctx.report({ kind: "dropped", element: "w:numPr", detail: unknownNumId(numPr.numId) });
    return node("Paragraph", options, readInline(content, ctx));
  }
  ctx.report({
    kind: "resolved",
    element: "w:numPr",
    detail: `docx.js keeps numbering only in the document body, so the marker "${marker.text}" is written as text`,
  });
  const suffix = marker.level?.suffix ?? "tab";
  const text = suffix === "space" ? `${marker.text} ` : marker.text;
  const markerContent = [...(text === "" ? [] : [text]), ...(suffix === "tab" ? [node("Tab")] : [])];
  const markerRuns = markerContent.length === 0 ? [] : textRuns({ ...options.run, ...marker.level?.style?.run }, markerContent);
  const indent = options.indent ?? marker.level?.style?.paragraph?.indent;
  const props = indent === undefined ? options : { ...options, indent };
  return node("Paragraph", props, [...markerRuns, ...readInline(content, ctx)]);
}

type LoneTextBox = {
  readonly box: TextBox;
  readonly holder: XmlElement;
  readonly run: XmlElement | null;
  readonly alternate: XmlElement | null;
};

function loneTextBox(content: readonly XmlElement[], ctx: ReadContext): LoneTextBox | null {
  const significant = content.filter((el) => !NOISE.has(el.name));
  const [holder] = significant;
  if (significant.length !== 1) return null;
  if (holder.name === "w:pict") {
    const box = textBoxOf(holder);
    return box === null ? null : { box, holder, run: null, alternate: null };
  }
  const inRun = holder.name === "w:r" ? elementsOf(holder).filter((el) => el.name !== "w:rPr") : [];
  const [only] = inRun;
  if (inRun.length !== 1) return null;
  if (only.name === "w:pict") {
    const box = textBoxOf(only);
    return box === null ? null : { box, holder, run: holder, alternate: null };
  }
  if (only.name !== "mc:AlternateContent") return null;
  const chosen = alternateContent(only, (el) => mapsToKind(el, "run", ctx));
  const [pict, ...rest] = chosen?.used === "Fallback" ? chosen.elements : [];
  const box = pict?.name === "w:pict" && rest.length === 0 ? textBoxOf(pict) : null;
  return box === null ? null : { box, holder, run: holder, alternate: only };
}

function textboxNode(read: ParagraphRead, lone: LoneTextBox, ctx: BodyContext): AuthorNode {
  if (lone.alternate !== null) {
    ctx.report({ kind: "resolved", element: lone.alternate.name, detail: "alternate content: used Fallback" });
  }
  if (lone.run !== null && elementsOf(childNamed(lone.run, "w:rPr")).length > 0) {
    ctx.report({ kind: "dropped", element: "w:rPr", detail: "the run holding a text box: docx.js writes none" });
  }
  if (read.numPr !== null) ctx.report({ kind: "dropped", element: "w:numPr", detail: "a Textbox cannot be numbered" });
  const { style, ...options } = read.options;
  const heading = style !== undefined && isOneOf(HEADINGS, style) ? style : undefined;
  if (style !== undefined && heading === undefined) {
    ctx.report({ kind: "dropped", element: "w:pStyle", detail: `"${style}": a Textbox takes only a heading style` });
  }
  const notes: Note[] = [];
  const shapeStyle = textBoxStyle(lone.box, notes);
  ctx.notes(notes);
  const props = {
    ...options,
    ...(heading === undefined ? {} : { heading }),
    ...(shapeStyle === undefined ? {} : { style: shapeStyle }),
  };
  return node("Textbox", props, readBlocks(lone.box.content, ctx, { rawBlocks: false, tables: false }));
}

type TableLevel = {
  readonly child: string;
  readonly own: ReadonlySet<string>;
  readonly read: (el: XmlElement, ctx: BodyContext) => AuthorNode;
  readonly holds: string;
};

const ROWS: TableLevel = { child: "w:tr", own: new Set(["w:tblPr", "w:tblGrid"]), read: readRow, holds: "rows" };
const CELLS: TableLevel = { child: "w:tc", own: new Set(["w:trPr"]), read: readCell, holds: "cells" };
const TABLE_DROPPED: Readonly<Record<string, string>> = {
  "w:tblPrEx": "docx.js has no table property exceptions option",
};

function readTableLevel(elements: readonly XmlElement[], ctx: BodyContext, level: TableLevel, out: AuthorNode[]): AuthorNode[] {
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
      const detail = own(TABLE_DROPPED, el.name) ?? `this level of a table holds only ${level.holds}`;
      ctx.report({ kind: "dropped", element: el.name, detail });
    }
  }
  return out;
}

function readTable(tbl: XmlElement, ctx: BodyContext): AuthorNode {
  const read = readTableProperties(tbl, ctx.env);
  ctx.notes(read.notes);
  return node("Table", read.options, readTableLevel(elementsOf(tbl), ctx, ROWS, []));
}

function readRow(tr: XmlElement, ctx: BodyContext): AuthorNode {
  const read = readRowProperties(childNamed(tr, "w:trPr"), ctx.env);
  ctx.notes(read.notes);
  return node("TableRow", read.options, readTableLevel(elementsOf(tr), ctx, CELLS, []));
}

function readCell(tc: XmlElement, ctx: BodyContext): AuthorNode {
  const read = readCellProperties(childNamed(tc, "w:tcPr"), ctx.env);
  ctx.notes(read.notes);
  const blocks = readBlocks(tc, ctx);
  const last = blocks[blocks.length - 1];
  const endsWithParagraph = last === undefined || (last.type !== "RawXml" && last.type !== "Table");
  return node("TableCell", read.options, endsWithParagraph ? blocks : [...blocks, node("Paragraph")]);
}

function readInline(elements: readonly XmlElement[], ctx: BodyContext, mode: InlineMode = "live"): AuthorNode[] {
  const props = new Map<XmlElement, RunOptions>();
  const scope: InlineScope = {
    ctx,
    mode,
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
  if (scope.mode === "deleted" && field.kind !== "page") {
    const detail = "a deleted field other than a page number: its code is dropped and its deleted result kept";
    scope.ctx.report({ kind: "dropped", element: "w:delInstrText", detail });
    return field.kind === "other" ? piecesOf(field.result, scope) : [];
  }
  switch (field.kind) {
    case "page":
      if (field.cached) scope.ctx.ignore("w:fldChar");
      return [{ kind: "run", run: field.run, value: node("PageNumber", { field: field.field }) }];
    case "node":
      return inline([field.node]);
    case "other": {
      const raw = field.raw.map((el) => (BOOKMARKS.has(el.name) ? renumberedBookmark(el, scope.ctx) : el));
      const check = rawXmlOf(raw, "inline", scope.ctx);
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
  if (NOISE.has(el.name) || MOVE_RANGES.has(el.name)) {
    ctx.ignore(el.name);
    return [];
  }
  if (isChange(el.name)) return changePieces(el, ctx);
  switch (el.name) {
    case "m:oMath": {
      const math = readMath(el, ctx);
      return math === null ? fallbackPieces(el, ctx) : inline([math]);
    }
    case "w:pict":
      return pictPieces(el, {}, ctx, () => fallbackPieces(el, ctx));
    case "mc:AlternateContent":
      return inline(readInline(alternateElements(el, "inline", ctx), ctx));
    case "w:hyperlink":
      return hyperlinkPieces(el, ctx);
    case "w:fldSimple":
      return simpleFieldPieces(el, ctx);
    case "w:bookmarkStart":
    case "w:bookmarkEnd": {
      const raw = rawBookmark(el, "inline", ctx);
      return raw === null ? [] : inline([raw]);
    }
    case "w:commentRangeStart":
    case "w:commentRangeEnd": {
      const mark = commentMark(el, ctx);
      return mark === null ? [] : inline([mark]);
    }
    case "w:sdt":
      if (isCheckBox(el)) return inline([readCheckBox(el, ctx)]);
      return fallbackPieces(el, ctx);
    default:
      return fallbackPieces(el, ctx);
  }
}

const COMMENT_MARKS: Readonly<Record<string, string>> = {
  "w:commentRangeStart": "CommentRangeStart",
  "w:commentRangeEnd": "CommentRangeEnd",
  "w:commentReference": "CommentReference",
};

function commentMark(el: XmlElement, ctx: BodyContext): AuthorNode | null {
  const source = attrOf(el, "w:id") ?? "";
  const id = ctx.parts.notes.commentId(source);
  if (id === null) {
    ctx.report({ kind: "dropped", element: el.name, detail: `comment ${source} is not in ${ctx.parts.notes.commentsPart}` });
    return null;
  }
  return node(COMMENT_MARKS[el.name], { id });
}

function changePieces(el: XmlElement, ctx: BodyContext): Piece[] {
  const deleted = isDeletion(el.name);
  const tracked = trackedRuns(el, ctx);
  if (tracked === null) {
    const detail = deleted ? "it holds more than runs; its deleted content is dropped with it" : "it holds more than runs; its content is kept untracked";
    ctx.report({ kind: "dropped", element: el.name, detail });
    return deleted ? [] : inline(readInline(elementsOf(el), ctx));
  }
  const nodes = readInline(tracked.runs, ctx, deleted ? "deleted" : "live");
  return inline(
    nodes.flatMap((read) => {
      if (read.type === "TextRun") return [node(tracked.kind, { ...tracked.props, ...read.props }, read.children)];
      const fate = deleted ? "dropped" : "kept untracked";
      ctx.report({ kind: "dropped", element: el.name, detail: `<${read.type}> cannot be a tracked change; it is ${fate}` });
      return deleted ? [] : [read];
    })
  );
}

function pictPieces(el: XmlElement, runProps: RunOptions, ctx: BodyContext, otherwise: () => Piece[]): Piece[] {
  const image = parseVmlImage(el, ctx);
  if (image !== null) {
    const read = readPicture(image, runProps, ctx);
    return read === null ? [] : inline([read]);
  }
  if (textBoxOf(el) !== null) {
    ctx.report({ kind: "dropped", element: el.name, detail: "text box sharing a paragraph with other content" });
    return [];
  }
  return otherwise();
}

function fallbackPieces(el: XmlElement, ctx: BodyContext): Piece[] {
  const read = fallback(el, "inline", ctx);
  if (read.kind === "raw") return inline([read.node]);
  return read.kind === "content" ? inline(readInline(read.elements, ctx)) : [];
}

const HYPERLINK_ATTRIBUTES = new Set(["r:id", "w:anchor", "w:history"]);

function hyperlinkPieces(el: XmlElement, ctx: BodyContext): Piece[] {
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

function simpleFieldPieces(el: XmlElement, ctx: BodyContext): Piece[] {
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
      const check = rawXmlOf([el], "inline", ctx);
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

const POSITIONAL_TAB = {
  "w:alignment": ["left", "center", "right"],
  "w:relativeTo": ["margin", "indent"],
  "w:leader": ["none", "dot", "hyphen", "underscore", "middleDot"],
} as const;

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
  if (isOwnKey(RUN_KINDS, el.name)) return content(node(RUN_KINDS[el.name]));
  if (isOwnKey(DROPPED_IN_RUN, el.name)) {
    ctx.report({ kind: "dropped", element: el.name, detail: DROPPED_IN_RUN[el.name] });
    return [];
  }
  switch (el.name) {
    case "w:drawing": {
      const image = readDrawing(el, scope.runProps(run), ctx);
      return image === null ? [] : inline([image]);
    }
    case "w:pict":
      return pictPieces(el, scope.runProps(run), ctx, () => runFallbackPieces(run, el, scope));
    case "mc:AlternateContent":
      return alternateElements(el, "run", ctx).flatMap((child) => atomPieces(run, child, scope));
    case "w:footnoteReference":
      return footnotePieces(run, el, ctx);
    case "w:commentReference": {
      const mark = commentMark(el, ctx);
      return mark === null ? [] : content(mark);
    }
    case "w:annotationRef":
      ctx.ignore(el.name);
      return [];
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
      if (char === null || !SYMBOL_CHAR.test(char)) return runFallbackPieces(run, el, scope);
      const font = attrOf(el, "w:font");
      const props = { ...scope.runProps(run), char, ...(font === null ? {} : { symbolfont: font }) };
      return inline([node("SymbolRun", props)]);
    }
    default:
      return runFallbackPieces(run, el, scope);
  }
}

function footnotePieces(run: XmlElement, el: XmlElement, ctx: BodyContext): Piece[] {
  if (ctx.part !== ctx.pkg.mainPart) {
    ctx.report({ kind: "dropped", element: el.name, detail: "docx.js writes footnote references only in the document body" });
    return [];
  }
  const id = attrOf(el, "w:id") ?? "";
  const footnote = ctx.parts.notes.footnote(id, ctx);
  if (footnote === null) return [];
  const onlyReference = elementsOf(run).every((child) => child === el || child.name === "w:rPr");
  for (const property of onlyReference ? elementsOf(childNamed(run, "w:rPr")) : []) {
    if (property.name === "w:rStyle" && attrOf(property, "w:val") === "FootnoteReference") ctx.ignore("w:rStyle");
    else ctx.report({ kind: "dropped", element: property.name, detail: "docx.js writes the footnote reference run's properties itself" });
  }
  const here = ctx.within(ctx.parts.notes.footnotesPart, ctx.at);
  return inline([footnoteNode(readBlocks(footnote, here, { rawBlocks: false }), id, here)]);
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
