/** The style sheet Word applies to a document react-docx writes, built the way docx.js builds styles.xml,
 *  so the preview shows what Word shows.
 *
 *  - Document defaults: `styles.default.document` when given, else docx.js's. docx.js does
 *    `new DocumentDefaults(options.document ?? {})`, which replaces rather than merges.
 *  - docx.js's 13 default styles: its own options with the authored `styles.default.<key>` spread over them
 *    shallowly, as its DefaultStylesFactory does (`new Heading1Style({ run: {…}, ...options.heading1 })`).
 *    So an authored `heading1: { run: { size: 40 } }` loses docx.js's heading colour.
 *  - Then the document's paragraph and character styles, and its raw `importedStyles`, read with the same
 *    codecs as the reader. The raw style marked w:default="1" (usually Normal) is the default paragraph
 *    style; docx.js marks none of its own.
 *  - Raw styles are read with an empty theme: the reader resolved theme fonts and colours in every option
 *    it wrote, and docx.js writes no theme part. */

import type * as docx from "docx";
import { NO_THEME_ENV, isOneOf, isOnValue, type Note } from "../ooxml/codec";
import { readRunOption, type RunOptions } from "../ooxml/run";
import { readStyleParagraph } from "../ooxml/style";
import { attrOf, childNamed, parseXmlRoots, type XmlElement } from "../ooxml/xml";
import { DEFAULT_STYLE_SLOTS } from "../schema/docx-facts";
import type { StylesProps } from "../schema/elements";
import { DOCX_DEFAULT_STYLES } from "./docx-default-styles.generated";

/** A style's paragraph options as the reader reads them: docx.js's style type leaves out what the paragraph
 *  codec also reads (and docx.js writes) for a style. */
export type SheetParagraph = docx.IParagraphStylePropertiesOptions & {
  readonly pageBreakBefore?: boolean;
  readonly tabStops?: readonly docx.TabStopDefinition[];
  readonly bidirectional?: boolean;
  readonly widowControl?: boolean;
};

type SheetStyle = {
  readonly type: "paragraph" | "character" | "table";
  readonly basedOn?: string;
  readonly paragraph?: SheetParagraph;
  readonly run?: RunOptions;
};

export type EffectiveSheet = {
  readonly docDefaults: { readonly paragraph: SheetParagraph; readonly run: RunOptions };
  readonly styles: ReadonlyMap<string, SheetStyle>;
  readonly defaultParagraphStyle: string | null;
};

type StyleOptions = { readonly basedOn?: string; readonly paragraph?: SheetParagraph; readonly run?: RunOptions };

type ImportedStyle = { readonly id: string; readonly isDefault: boolean; readonly sheet: SheetStyle };

const SHEET_TYPES: readonly SheetStyle["type"][] = ["paragraph", "character", "table"];

const MAX_STYLE_HOPS = 10;

function sheetStyle(type: SheetStyle["type"], { basedOn, paragraph, run }: StyleOptions): SheetStyle {
  return {
    type,
    ...(basedOn === undefined ? {} : { basedOn }),
    ...(paragraph === undefined ? {} : { paragraph }),
    ...(run === undefined ? {} : { run }),
  };
}

function readImportedStyle(style: XmlElement): ImportedStyle | null {
  const type = attrOf(style, "w:type") ?? "paragraph";
  const id = attrOf(style, "w:styleId");
  if (id === null || !isOneOf(SHEET_TYPES, type)) return null;
  const notes: Note[] = [];
  const pPr = childNamed(style, "w:pPr");
  const rPr = childNamed(style, "w:rPr");
  const isDefault = attrOf(style, "w:default");
  return {
    id,
    isDefault: isDefault !== null && isOnValue(isDefault),
    sheet: sheetStyle(type, {
      basedOn: attrOf(childNamed(style, "w:basedOn"), "w:val") ?? undefined,
      paragraph: pPr === null ? undefined : readStyleParagraph(pPr, NO_THEME_ENV, notes).paragraph,
      run: (rPr === null ? null : readRunOption(rPr, NO_THEME_ENV, notes)) ?? undefined,
    }),
  };
}

export function effectiveSheet(styles: StylesProps | undefined): EffectiveSheet {
  const authored = styles?.default;
  const builtIn = DOCX_DEFAULT_STYLES.default;
  const document = authored?.document ?? builtIn?.document ?? {};
  const byId = new Map<string, SheetStyle>();
  for (const [id, slot] of Object.entries(DEFAULT_STYLE_SLOTS)) {
    byId.set(id, sheetStyle(slot.kind, { ...builtIn?.[slot.key], ...authored?.[slot.key] }));
  }
  for (const style of styles?.paragraphStyles ?? []) byId.set(style.id, sheetStyle("paragraph", style));
  for (const style of styles?.characterStyles ?? []) byId.set(style.id, sheetStyle("character", style));
  let defaultParagraphStyle: string | null = null;
  for (const style of (styles?.importedStyles ?? []).flatMap(parseXmlRoots)) {
    const read = readImportedStyle(style);
    if (read === null) continue;
    byId.set(read.id, read.sheet);
    if (read.isDefault && read.sheet.type === "paragraph") defaultParagraphStyle = read.id;
  }
  return {
    docDefaults: { paragraph: document.paragraph ?? {}, run: document.run ?? {} },
    styles: byId,
    defaultParagraphStyle,
  };
}

export function styleChain(sheet: EffectiveSheet, id: string | null | undefined): readonly SheetStyle[] {
  const chain: SheetStyle[] = [];
  const seen = new Set<string>();
  let next = id ?? null;
  while (next !== null && !seen.has(next) && chain.length < MAX_STYLE_HOPS) {
    seen.add(next);
    const style = sheet.styles.get(next);
    if (style === undefined) break;
    chain.unshift(style);
    next = style.basedOn ?? null;
  }
  return chain;
}
