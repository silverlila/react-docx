/** w:style → a docx.js paragraph or character style, or the style's raw XML when docx.js cannot express
 *  it; and w:docDefaults → docx.js document defaults.
 *
 *  - Raw styles (decision 8): a paragraph or character style marked w:default (docx.js's styles never
 *    write w:default), and every table and numbering style. They become `importedStyles` strings, so they
 *    must pass the same checks as RawXml: no r: attribute, and xmlRoots accepts them.
 *  - A style's w:pPr reads without w:pStyle, which only a paragraph carries. A paragraph style's w:numPr
 *    is returned beside the options, for unit 05.
 *  - docx.js gives a character style uiPriority 99 and unhideWhenUsed when they are absent, so a
 *    character style read from Word gains both on its first write (decision 10). */

import type * as docx from "docx";
import { attrOf, childNamed, serializeXml, type XmlElement } from "./xml";
import { xmlRoots } from "../tree/xml-roots";
import {
  applyFates,
  dropped,
  isOnValue,
  mapTo,
  onOff,
  stringVal,
  wholeNumberVal,
  HANDLED_BESIDE,
  noOption,
  type CodecEnv,
  type CodecResult,
  type Draft,
  type FateTable,
  type Note,
  type ValueReader,
} from "./codec";
import { readParagraphProperties, type ParagraphOptions, type ParagraphRead } from "./paragraph";
import { readRunOption } from "./run";

export type StyleRead =
  | {
      readonly kind: "paragraph";
      readonly options: docx.IParagraphStyleOptions;
      readonly numPr: { numId: string; level: number } | null;
      readonly notes: readonly Note[];
    }
  | { readonly kind: "character"; readonly options: docx.ICharacterStyleOptions; readonly notes: readonly Note[] }
  | { readonly kind: "raw"; readonly xml: string; readonly because: "default" | "table" | "numbering" };

export type StyleDropped = { readonly kind: "dropped"; readonly because: string };

/** The paragraph options a style, a numbering level or the document defaults can hold. */
export type StyleParagraph = {
  readonly paragraph: Omit<ParagraphOptions, "style">;
  readonly numPr: ParagraphRead["numPr"];
};

type StyleOptions = Omit<docx.IParagraphStyleOptions, "id">;
type RawBecause = Extract<StyleRead, { kind: "raw" }>["because"];


const NOT_A_TABLE_STYLE = "only a table style has table properties";

/** A w:pPr outside a body paragraph: its options without w:pStyle, and its w:numPr. */
export function readStyleParagraph(pPr: XmlElement, env: CodecEnv, notes: Note[]): StyleParagraph {
  const read = readParagraphProperties(pPr, env);
  notes.push(...read.notes);
  const { style, ...paragraph } = read.options;
  if (style !== undefined) notes.push(dropped("w:pStyle", "only a paragraph names its paragraph style"));
  if (read.sectPr !== null) notes.push(dropped("w:sectPr", "only a body paragraph ends a section"));
  return { paragraph, numPr: read.numPr };
}

const to = <K extends keyof StyleOptions>(key: K, read: ValueReader<NonNullable<Draft<StyleOptions>[K]>>) =>
  mapTo<StyleOptions, K>(key, read);

const COMMON_FATES: FateTable<StyleOptions> = {
  "w:name": to("name", stringVal),
  "w:aliases": noOption("docx.js has no style aliases option"),
  "w:basedOn": to("basedOn", stringVal),
  "w:next": to("next", stringVal),
  "w:link": to("link", stringVal),
  "w:autoRedefine": noOption("docx.js has no autoRedefine option"),
  "w:hidden": noOption("docx.js has no hidden style option"),
  "w:uiPriority": to("uiPriority", wholeNumberVal),
  "w:semiHidden": to("semiHidden", onOff(true)),
  "w:unhideWhenUsed": to("unhideWhenUsed", onOff(true)),
  "w:qFormat": to("quickFormat", onOff(true)),
  "w:locked": noOption("docx.js has no locked style option"),
  "w:personal": noOption("docx.js has no personal style option"),
  "w:personalCompose": noOption("docx.js has no personalCompose option"),
  "w:personalReply": noOption("docx.js has no personalReply option"),
  "w:rsid": { fate: "ignored" },
  "w:rPr": to("run", readRunOption),
  "w:tblPr": noOption(NOT_A_TABLE_STYLE),
  "w:trPr": noOption(NOT_A_TABLE_STYLE),
  "w:tcPr": noOption(NOT_A_TABLE_STYLE),
  "w:tblStylePr": noOption(NOT_A_TABLE_STYLE),
};

const PARAGRAPH_STYLE_FATES: FateTable<StyleOptions> = { ...COMMON_FATES, "w:pPr": HANDLED_BESIDE };

const CHARACTER_STYLE_FATES: FateTable<StyleOptions> = {
  ...COMMON_FATES,
  "w:pPr": noOption("a character style has no paragraph properties"),
};

function rawBecause(style: XmlElement, type: string): RawBecause | null {
  if (type === "table" || type === "numbering") return type;
  const isDefault = attrOf(style, "w:default");
  return isDefault !== null && isOnValue(isDefault) ? "default" : null;
}

function rawStyle(style: XmlElement, because: RawBecause): StyleRead | StyleDropped {
  const xml = serializeXml(style);
  const roots = xmlRoots(xml);
  if (roots.kind === "relationship") {
    return { kind: "dropped", because: "it carries an r: relationship reference, which raw XML cannot keep" };
  }
  if (roots.kind !== "roots") return { kind: "dropped", because: roots.reason };
  return { kind: "raw", xml, because };
}

export function readStyle(style: XmlElement, env: CodecEnv): StyleRead | StyleDropped {
  const type = attrOf(style, "w:type") ?? "paragraph";
  if (type !== "paragraph" && type !== "character" && type !== "table" && type !== "numbering") {
    return { kind: "dropped", because: `w:type="${type}" is not a style type` };
  }
  const because = rawBecause(style, type);
  if (because !== null) return rawStyle(style, because);

  const id = attrOf(style, "w:styleId");
  if (id === null) return { kind: "dropped", because: "it has no w:styleId" };

  if (type === "character") {
    const { options, notes } = applyFates(style, CHARACTER_STYLE_FATES, env);
    return { kind: "character", options: { id, ...options }, notes };
  }
  const { options, notes } = applyFates(style, PARAGRAPH_STYLE_FATES, env);
  const pPr = childNamed(style, "w:pPr");
  if (pPr === null) return { kind: "paragraph", options: { id, ...options }, numPr: null, notes };
  const { paragraph, numPr } = readStyleParagraph(pPr, env, notes);
  const withParagraph = Object.keys(paragraph).length === 0 ? options : { ...options, paragraph };
  return { kind: "paragraph", options: { id, ...withParagraph }, numPr, notes };
}

/** A w:numPr outside a style, where docx.js has no numbering option. */
export function dropNumbering(numPr: StyleParagraph["numPr"], where: string, notes: Note[]): void {
  if (numPr !== null) notes.push(dropped("w:numPr", `docx.js has no numbering option in ${where}`));
}

const DOC_DEFAULTS_FATES: FateTable<docx.IDocumentDefaultsOptions> = {
  "w:rPrDefault": {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const rPr = childNamed(el, "w:rPr");
      const run = rPr === null ? null : readRunOption(rPr, env, notes);
      if (run !== null) out.run = run;
    },
  },
  "w:pPrDefault": {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const pPr = childNamed(el, "w:pPr");
      if (pPr === null) return;
      const { paragraph, numPr } = readStyleParagraph(pPr, env, notes);
      dropNumbering(numPr, "the document defaults", notes);
      if (Object.keys(paragraph).length > 0) out.paragraph = paragraph;
    },
  },
};

/** w:docDefaults → docx.js IDocumentDefaultsOptions { paragraph, run }. */
export function readDocDefaults(
  docDefaults: XmlElement | null,
  env: CodecEnv
): CodecResult<docx.IDocumentDefaultsOptions> {
  return applyFates(docDefaults, DOC_DEFAULTS_FATES, env);
}
