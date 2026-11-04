/** The style sheet Word applies to a document react-docx writes, built the way docx.js builds styles.xml
 *  (decision 14), so the preview shows what Word shows.
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
import type { CodecEnv } from "../ooxml/codec";
import type { RunOptions } from "../ooxml/run";
import { readStyleForPreview } from "../ooxml/style";
import { parseXml } from "../read/xml";
import { DEFAULT_STYLE_SLOTS } from "../schema/docx-facts";
import type { StylesProps } from "../schema/elements";
import { DOCX_DEFAULT_STYLES } from "./docx-default-styles.generated";

/** The paragraph options a style or the document defaults can set, a list's numbering among them. */
export type SheetParagraph = docx.IParagraphStylePropertiesOptions & { readonly pageBreakBefore?: boolean };

export type SheetStyle = {
  readonly type: "paragraph" | "character" | "table";
  readonly basedOn?: string;
  readonly paragraph?: SheetParagraph;
  readonly run?: RunOptions;
};

export type EffectiveSheet = {
  readonly docDefaults: { readonly paragraph: SheetParagraph; readonly run: RunOptions };
  readonly styles: ReadonlyMap<string, SheetStyle>;
  /** The raw style with w:default="1", if any. */
  readonly defaultParagraphStyle: string | null;
};

type StyleOptions = { readonly basedOn?: string; readonly paragraph?: SheetParagraph; readonly run?: RunOptions };

/** folio's cap on a basedOn chain, which also stops a cycle. */
const MAX_STYLE_HOPS = 10;

const NO_FONTS = { latin: null, eastAsia: null, complex: null };
const EMPTY_ENV: CodecEnv = { theme: { fonts: { major: NO_FONTS, minor: NO_FONTS }, colors: {} } };

function sheetStyle(type: SheetStyle["type"], { basedOn, paragraph, run }: StyleOptions): SheetStyle {
  return {
    type,
    ...(basedOn === undefined ? {} : { basedOn }),
    ...(paragraph === undefined ? {} : { paragraph }),
    ...(run === undefined ? {} : { run }),
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
  for (const xml of styles?.importedStyles ?? []) {
    const read = readStyleForPreview(parseXml(xml), EMPTY_ENV);
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

/** The style `id` and the styles it is basedOn, base first. Stops at a missing style or a cycle. */
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
