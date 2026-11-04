/** Fields (w:fldSimple and complex w:fldChar fields) and the CheckBox and TableOfContents content controls.
 *
 *  - Page fields always map to PageNumber; their cached result is ignored, because Word recomputes it.
 *    Their instruction is matched trimmed, first token uppercased, with `\* MERGEFORMAT` the only switch:
 *    exactly what docx.js writes (classes Page, NumberOfPages, NumberOfPagesSection, CurrentSection).
 *  - Every other field and content control maps to its kind only in the exact shape docx.js writes for it
 *    (decision 18): SimpleField, SimpleMailMergeField, SequentialIdentifier, PageReference, CheckBox,
 *    TableOfContents. Word's versions carry cached results those kinds cannot hold, so they are left to
 *    the caller as "other" and kept as RawXml.
 *  - docx.js writes those field runs with no run properties, so a field whose runs have any is not in
 *    its shape: mapping it would lose them.
 *  - A complex field is found from its begin to the end that brings the nesting depth back to zero. Its
 *    instruction is the w:instrText at depth one before its w:fldChar separate.
 *  - CheckBox: docx.js writes the content from the options, so w:sdtContent is ignored. States equal to
 *    docx.js's defaults (2612 / 2610 in MS Gothic) are left out, as an author would. */

import type * as docx from "docx";
import { dropped, isOnValue, type Mutable, type Note } from "../ooxml/codec";
import { PAGE_NUMBER_VALUES } from "../schema/docx-facts";
import { isOwnKey } from "../schema/own";
import type { AuthorNode } from "../tree/author";
import type { ReadContext } from "./context";
import { attrOf, childNamed, elementsOf, textOf, type XmlElement } from "../ooxml/xml";

/** One unit of an inline container's content: a child of a w:r (with its run), or any other element. */
export type Item =
  | { readonly kind: "atom"; readonly run: XmlElement; readonly el: XmlElement }
  | { readonly kind: "element"; readonly el: XmlElement };

export type PageField = (typeof PAGE_NUMBER_VALUES)[number];

export type ComplexField =
  | { readonly kind: "page"; readonly field: PageField; readonly run: XmlElement; readonly cached: boolean }
  | { readonly kind: "node"; readonly node: AuthorNode }
  | { readonly kind: "other"; readonly raw: readonly XmlElement[]; readonly result: readonly Item[] };

export type SimpleFieldRead =
  | { readonly kind: "page"; readonly field: PageField; readonly run: XmlElement | null; readonly cached: boolean }
  | { readonly kind: "node"; readonly node: AuthorNode }
  | { readonly kind: "other" };

type TocOptions = docx.ITableOfContentsOptions;
type KeysOfType<T, V> = { [K in keyof T]-?: NonNullable<T[K]> extends V ? K : never }[keyof T];

const PAGE_FIELDS: Readonly<Record<string, PageField>> = {
  PAGE: "CURRENT",
  NUMPAGES: "TOTAL_PAGES",
  SECTIONPAGES: "TOTAL_PAGES_IN_SECTION",
  SECTION: "SECTION",
};

const MERGEFORMAT = "\\* MERGEFORMAT";
const SEQ = /^SEQ (\S+)$/;
const PAGEREF = /^PAGEREF (\S+)( \\h)?( \\p)?$/;
const MERGEFIELD = /^ MERGEFIELD (\S+) $/;
const TOC_SWITCH = / \\([a-z])(?: "([^"]*)")?/y;
const WHOLE_NUMBER = /^[0-9]+$/;
const SYMBOL_HEX = /^[0-9A-Fa-f]{4}$/;

const node = (type: string, props: Readonly<Record<string, unknown>> = {}): AuthorNode => ({ type, props, children: [] });

export function pageFieldOf(instruction: string): PageField | null {
  const [first = "", ...switches] = instruction.trim().split(/\s+/);
  const key = first.toUpperCase();
  if (!isOwnKey(PAGE_FIELDS, key)) return null;
  const rest = switches.join(" ");
  return rest === "" || rest.toUpperCase() === MERGEFORMAT ? PAGE_FIELDS[key] : null;
}

export function fldCharType(item: Item): string | null {
  return item.kind === "atom" && item.el.name === "w:fldChar" ? attrOf(item.el, "w:fldCharType") : null;
}

function matchingEnd(items: readonly Item[], begin: number): number | null {
  let depth = 0;
  for (let i = begin; i < items.length; i++) {
    const type = fldCharType(items[i]);
    if (type === "begin") depth += 1;
    else if (type === "end" && --depth === 0) return i;
  }
  return null;
}

/** The complex fields in `items`: each top-level begin index with its end index, and the begins that never
 *  end in `items`. */
export function fieldSpans(items: readonly Item[]): { readonly spans: Map<number, number>; readonly unclosed: Set<number> } {
  const spans = new Map<number, number>();
  const unclosed = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (fldCharType(items[i]) !== "begin") continue;
    const end = matchingEnd(items, i);
    if (end === null) {
      unclosed.add(i);
      continue;
    }
    spans.set(i, end);
    i = end;
  }
  return { spans, unclosed };
}

const hasRunProperties = (run: XmlElement): boolean => elementsOf(childNamed(run, "w:rPr")).length > 0;

/** The span's runs as written: consecutive atoms of one w:r become one w:r with that run's properties. */
function rawRunsOf(span: readonly Item[]): XmlElement[] {
  const out: XmlElement[] = [];
  let run: XmlElement | null = null;
  let children: XmlElement[] = [];
  const flush = () => {
    if (run !== null) {
      const rPr = childNamed(run, "w:rPr");
      out.push({ name: run.name, attributes: run.attributes, children: rPr === null ? children : [rPr, ...children] });
    }
    run = null;
    children = [];
  };
  for (const item of span) {
    if (item.kind === "element") {
      flush();
      out.push(item.el);
      continue;
    }
    if (item.run !== run) flush();
    run = item.run;
    children.push(item.el);
  }
  flush();
  return out;
}

/** SEQ and PAGEREF in the shape docx.js writes them: plain runs, nothing but the field. */
function writerShapedField(instruction: string, span: readonly Item[], separate: number | null, result: readonly Item[]): AuthorNode | null {
  if (span.some((item) => item.kind === "element" || hasRunProperties(item.run))) return null;
  const seq = SEQ.exec(instruction);
  if (seq !== null && separate !== null && result.length === 0) return node("SequentialIdentifier", { identifier: seq[1] });
  const pageRef = PAGEREF.exec(instruction);
  if (pageRef === null || separate !== null) return null;
  return node("PageReference", {
    bookmarkId: pageRef[1],
    ...(pageRef[2] === undefined ? {} : { hyperlink: true }),
    ...(pageRef[3] === undefined ? {} : { useRelativePosition: true }),
  });
}

/** Classifies one complex field: `span` runs from its begin to its matching end. */
export function complexField(span: readonly Item[]): ComplexField {
  let depth = 0;
  let nested = false;
  let separate: number | null = null;
  let instruction = "";
  let instructionRun: XmlElement | null = null;
  for (let i = 0; i < span.length; i++) {
    const item = span[i];
    const type = fldCharType(item);
    if (type === "begin") {
      depth += 1;
      nested ||= depth > 1;
    } else if (type === "end") {
      depth -= 1;
    } else if (depth === 1 && separate === null && type === "separate") {
      separate = i;
    } else if (depth === 1 && separate === null && item.kind === "atom" && item.el.name === "w:instrText") {
      instruction += textOf(item.el);
      instructionRun ??= item.run;
    }
  }
  const result = separate === null ? [] : span.slice(separate + 1, span.length - 1);
  const field = nested ? null : pageFieldOf(instruction);
  if (field !== null && instructionRun !== null) {
    return { kind: "page", field, run: instructionRun, cached: result.length > 0 };
  }
  const shaped = nested ? null : writerShapedField(instruction, span, separate, result);
  return shaped === null ? { kind: "other", raw: rawRunsOf(span), result } : { kind: "node", node: shaped };
}

/** w:fldSimple: a page field, a kind in docx.js's shape (no content, or one plain w:r holding one w:t), or
 *  "other". */
export function simpleField(fldSimple: XmlElement): SimpleFieldRead {
  const instruction = attrOf(fldSimple, "w:instr");
  if (instruction === null) return { kind: "other" };
  const content = elementsOf(fldSimple);
  const field = pageFieldOf(instruction);
  if (field !== null) {
    return { kind: "page", field, run: content.find((el) => el.name === "w:r") ?? null, cached: content.length > 0 };
  }
  if (Object.keys(fldSimple.attributes).length !== 1) return { kind: "other" };
  if (content.length === 0) return { kind: "node", node: node("SimpleField", { instruction }) };
  const [run] = content;
  const [text, ...rest] = elementsOf(run).filter((el) => el.name !== "w:rPr");
  if (content.length !== 1 || run.name !== "w:r" || hasRunProperties(run) || text?.name !== "w:t" || rest.length > 0) {
    return { kind: "other" };
  }
  const cachedValue = textOf(text);
  const merge = MERGEFIELD.exec(instruction);
  if (merge !== null && cachedValue === `«${merge[1]}»`) {
    return { kind: "node", node: node("SimpleMailMergeField", { fieldName: merge[1] }) };
  }
  return { kind: "node", node: node("SimpleField", { instruction, cachedValue }) };
}

const DEFAULT_CHECKED = { value: "2612", font: "MS Gothic" };
const DEFAULT_UNCHECKED = { value: "2610", font: "MS Gothic" };

export const isCheckBox = (sdt: XmlElement): boolean => childNamed(childNamed(sdt, "w:sdtPr"), "w14:checkbox") !== null;

function symbolState(el: XmlElement, defaults: typeof DEFAULT_CHECKED, notes: Note[]): docx.ICheckboxSymbolProperties | null {
  const state: Mutable<docx.ICheckboxSymbolProperties> = {};
  const value = attrOf(el, "w14:val");
  const font = attrOf(el, "w14:font");
  if (value !== null && !SYMBOL_HEX.test(value)) notes.push(dropped(el.name, `w14:val="${value}" is not a 4-digit hex symbol`));
  else if (value !== null && value.toUpperCase() !== defaults.value) state.value = value;
  if (font !== null && font !== defaults.font) state.font = font;
  return Object.keys(state).length === 0 ? null : state;
}

function readCheckBoxOptions(checkbox: XmlElement, out: Mutable<docx.ICheckboxSymbolOptions>, notes: Note[]): void {
  for (const el of elementsOf(checkbox)) {
    if (el.name === "w14:checked") {
      if (isOnValue(attrOf(el, "w14:val") ?? "1")) out.checked = true;
    } else if (el.name === "w14:checkedState" || el.name === "w14:uncheckedState") {
      const checked = el.name === "w14:checkedState";
      const state = symbolState(el, checked ? DEFAULT_CHECKED : DEFAULT_UNCHECKED, notes);
      if (state !== null && checked) out.checkedState = state;
      else if (state !== null) out.uncheckedState = state;
    } else {
      notes.push(dropped(el.name, "docx.js's CheckBox has no option for it"));
    }
  }
}

/** An inline w:sdt holding w14:checkbox → CheckBox. */
export function readCheckBox(sdt: XmlElement, ctx: ReadContext): AuthorNode {
  const options: Mutable<docx.ICheckboxSymbolOptions> = {};
  const notes: Note[] = [];
  for (const child of elementsOf(sdt)) {
    if (child.name === "w:sdtContent") {
      ctx.ignore("w:sdtContent");
    } else if (child.name !== "w:sdtPr") {
      notes.push(dropped(child.name, "docx.js's CheckBox has no option for it"));
    } else {
      for (const el of elementsOf(child)) {
        const alias = el.name === "w:alias" ? attrOf(el, "w:val") : null;
        if (alias !== null) options.alias = alias;
        else if (el.name === "w14:checkbox") readCheckBoxOptions(el, options, notes);
        else if (el.name === "w:id") ctx.ignore("w:id");
        else notes.push(dropped(el.name, "docx.js's CheckBox has no option for it"));
      }
    }
  }
  ctx.notes(notes);
  return node("CheckBox", options);
}

const TOC_TEXT_SWITCHES = {
  a: "captionLabel",
  b: "entriesFromBookmark",
  c: "captionLabelIncludingNumbers",
  d: "sequenceAndPageNumbersSeparator",
  f: "tcFieldIdentifier",
  l: "tcFieldLevelRange",
  n: "pageNumbersEntryLevelsRange",
  o: "headingStyleRange",
  p: "entryAndPageNumberSeparator",
  s: "seqFieldIdentifierForPrefix",
} as const satisfies Readonly<Record<string, KeysOfType<TocOptions, string>>>;

const TOC_FLAG_SWITCHES = {
  h: "hyperlink",
  u: "useAppliedParagraphOutlineLevel",
  w: "preserveTabInEntries",
  x: "preserveNewLineInEntries",
  z: "hideTabAndPageNumbersInWebView",
} as const satisfies Readonly<Record<string, KeysOfType<TocOptions, boolean>>>;

/** `\t "Style,1,Other,2"` → stylesWithLevels, or null when it is not pairs of a name and a whole number. */
function stylesWithLevels(value: string): TocOptions["stylesWithLevels"] | null {
  const parts = value.split(",");
  if (parts.length % 2 !== 0) return null;
  const styles: { styleName: string; level: number }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i] === "" || !WHOLE_NUMBER.test(parts[i + 1])) return null;
    styles.push({ styleName: parts[i], level: Number(parts[i + 1]) });
  }
  return styles;
}

/** Inverts docx.js's FieldInstruction: every switch must be one it writes, with the value it writes. */
function tocOptions(instruction: string): TocOptions | null {
  if (!instruction.startsWith("TOC")) return null;
  const options: Mutable<TocOptions> = {};
  const seen = new Set<string>();
  TOC_SWITCH.lastIndex = 3;
  while (TOC_SWITCH.lastIndex < instruction.length) {
    const match = TOC_SWITCH.exec(instruction);
    if (match === null) return null;
    const [, name, value] = match;
    if (seen.has(name)) return null;
    seen.add(name);
    if (isOwnKey(TOC_FLAG_SWITCHES, name) && value === undefined) {
      options[TOC_FLAG_SWITCHES[name]] = true;
    } else if (isOwnKey(TOC_TEXT_SWITCHES, name) && value) {
      options[TOC_TEXT_SWITCHES[name]] = value;
    } else if (name === "t" && value) {
      const styles = stylesWithLevels(value);
      if (styles === null) return null;
      options.stylesWithLevels = styles;
    } else {
      return null;
    }
  }
  return options;
}

const fldChars = (run: XmlElement): string[] =>
  elementsOf(run).map((el) => (el.name === "w:fldChar" ? `fldChar:${attrOf(el, "w:fldCharType")}` : el.name));

/** The one plain run a docx.js TOC paragraph holds, or null. */
function onlyRun(p: XmlElement): XmlElement | null {
  const [run, ...rest] = elementsOf(p);
  return run?.name === "w:r" && rest.length === 0 && childNamed(run, "w:rPr") === null ? run : null;
}

/** A block w:sdt in docx.js's TableOfContents shape → TableOfContents, else null. The shape is a w:sdtPr
 *  holding at most w:alias, and content of exactly two paragraphs: [begin, TOC instruction, separate] and
 *  [end]. Anything else, such as Word's w:docPartObj or entries between the two, is not that shape. */
export function readTableOfContents(sdt: XmlElement): AuthorNode | null {
  const [sdtPr, sdtContent, ...extra] = elementsOf(sdt);
  if (sdtPr?.name !== "w:sdtPr" || sdtContent?.name !== "w:sdtContent" || extra.length > 0) return null;
  const properties = elementsOf(sdtPr);
  if (properties.some((el) => el.name !== "w:alias")) return null;
  const [first, last, ...more] = elementsOf(sdtContent);
  if (first?.name !== "w:p" || last?.name !== "w:p" || more.length > 0) return null;
  const begin = onlyRun(first);
  const end = onlyRun(last);
  if (begin === null || end === null) return null;
  if (fldChars(begin).join(" ") !== "fldChar:begin w:instrText fldChar:separate" || fldChars(end).join(" ") !== "fldChar:end") {
    return null;
  }
  const options = tocOptions(textOf(elementsOf(begin)[1]));
  if (options === null) return null;
  const alias = attrOf(childNamed(sdtPr, "w:alias"), "w:val");
  return node("TableOfContents", { ...(alias === null ? {} : { alias }), ...options });
}
