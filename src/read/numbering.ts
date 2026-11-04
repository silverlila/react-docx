/** docx.js writes one w:lvlOverride on every w:num: level 0's startOverride, set to the first level's
 *  `start` when that is a non-zero whole number and to 1 otherwise (createConcreteNumberingInstance). That
 *  override is accepted; any other is dropped. docx.js throws above level 9.
 *
 *  numId "0" means "not a list, even if the style is", and docx.js writes it as that numId. A numbering
 *  option without a style makes docx.js add pStyle ListParagraph; `custom: true` stops that. docx.js's own
 *  `default-bullet-numbering` abstractNum is counted ignored. */

import type * as docx from "docx";
import { applyFates, type FateTable, type Note } from "../ooxml/codec";
import { MAX_LEVEL, readLevel } from "../ooxml/level";
import { decimalFormats, levelOf, markerText, type Counters } from "../ooxml/markers";
import { own } from "../schema/own";
import { partOfType, type ReadContext } from "./context";
import type { Ordinals } from "./ordinals";
import { attrOf, childNamed, elementsOf, type XmlElement } from "../ooxml/xml";

type Levels = readonly docx.ILevelsOptions[];

type ListRef = { readonly reference: string; readonly instance: number };

type Marker = { readonly text: string; readonly level: docx.ILevelsOptions | undefined };

export type NumberingReader = {
  refOf(numId: string): ListRef | null;
  config(): docx.INumberingOptions["config"];
  reportUnused(): void;
  markerOf(numId: string, level: number, ctx: ReadContext): Marker | null;
};

type AbstractNumOptions = { readonly levels: Levels };
type Num = { readonly abstractNumId: string; readonly overrides: readonly XmlElement[] };

const ABSTRACT_NUM_FATES: FateTable<AbstractNumOptions> = {
  "w:nsid": { fate: "ignored" },
  "w:multiLevelType": { fate: "ignored" },
  "w:tmpl": { fate: "ignored" },
  "w:name": { fate: "ignored" },
  "w:numStyleLink": { fate: "dropped", why: "docx.js cannot link a list to a numbering style" },
  "w:styleLink": { fate: "dropped", why: "docx.js cannot make a list the definition of a numbering style" },
  "w:lvl": {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const level = readLevel(el, env);
      notes.push(...level.notes);
      out.levels = [...(out.levels ?? []), level.options];
    },
  },
};

const OTHER_CHILDREN: Readonly<Record<string, Note["fate"]>> = {
  "w:numPicBullet": "dropped",
  "w:numIdMacAtCleanup": "ignored",
};

type NumberingOption =
  | { readonly reference: string; readonly level: number; readonly instance: number; readonly custom?: true }
  | false;

export const unknownNumId = (numId: string): string => `numId ${numId} is not defined in numbering.xml`;

export function numberingOption(
  numPr: { readonly numId: string; readonly level: number },
  options: { readonly custom: boolean },
  numbering: NumberingReader,
  ctx: ReadContext
): NumberingOption | null {
  if (numPr.numId === "0") return false;
  if (numPr.level < 0 || numPr.level > MAX_LEVEL) {
    ctx.report({ kind: "dropped", element: "w:numPr", detail: `level ${numPr.level} is not one docx.js writes (0 to ${MAX_LEVEL})` });
    return null;
  }
  const ref = numbering.refOf(numPr.numId);
  if (ref === null) {
    ctx.report({ kind: "dropped", element: "w:numPr", detail: unknownNumId(numPr.numId) });
    return null;
  }
  const { reference, instance } = ref;
  return { reference, level: numPr.level, instance, ...(options.custom ? { custom: true as const } : {}) };
}

function instanceOf(ordinals: Ordinals, reference: string, numId: string): number {
  return ordinals(`instance:${reference}`, numId) - 1;
}

function writerStart(levels: Levels): string {
  const start = levels[0]?.start;
  return start !== undefined && start !== 0 && Number.isInteger(start) ? String(start) : "1";
}

function isWriterOverride(override: XmlElement, levels: Levels): boolean {
  const [only, ...rest] = elementsOf(override);
  return (
    attrOf(override, "w:ilvl") === "0" &&
    rest.length === 0 &&
    only?.name === "w:startOverride" &&
    attrOf(only, "w:val") === writerStart(levels)
  );
}

export function readNumberingPart(ctx: ReadContext): NumberingReader {
  const path = partOfType(ctx.pkg, "/numbering", "word/numbering.xml");
  const here = ctx.within(path, []);
  const abstracts = new Map<string, XmlElement>();
  const nums = new Map<string, Num>();
  const incomplete = (el: XmlElement) =>
    here.report({ kind: "dropped", element: el.name, detail: "its id is missing or defined twice" });
  for (const el of elementsOf(ctx.readPart(path))) {
    if (el.name === "w:abstractNum") {
      const id = attrOf(el, "w:abstractNumId");
      if (id === null || abstracts.has(id)) incomplete(el);
      else abstracts.set(id, el);
    } else if (el.name === "w:num") {
      const numId = attrOf(el, "w:numId");
      const abstractNumId = attrOf(childNamed(el, "w:abstractNumId"), "w:val");
      if (numId === null || abstractNumId === null || nums.has(numId)) {
        incomplete(el);
        continue;
      }
      for (const child of elementsOf(el)) {
        if (child.name !== "w:abstractNumId" && child.name !== "w:lvlOverride") {
          here.report({ kind: "dropped", element: child.name, detail: `numId ${numId}: docx.js has no option for it` });
        }
      }
      nums.set(numId, { abstractNumId, overrides: elementsOf(el).filter((child) => child.name === "w:lvlOverride") });
    } else {
      const fate = own(OTHER_CHILDREN, el.name) ?? "dropped";
      here.notes([{ fate, element: el.name, detail: "docx.js has no numbering option for it" }]);
    }
  }

  const levels = new Map<string, Levels>();
  const levelsOf = (abstractNumId: string, abstract: XmlElement): Levels => {
    const known = levels.get(abstractNumId);
    if (known !== undefined) return known;
    const read = applyFates(abstract, ABSTRACT_NUM_FATES, ctx.env);
    here.notes(read.notes);
    const own = read.options.levels ?? [];
    levels.set(abstractNumId, own);
    return own;
  };
  const listOf = (numId: string): { readonly num: Num; readonly levels: Levels } | null => {
    const num = nums.get(numId);
    const abstract = num === undefined ? undefined : abstracts.get(num.abstractNumId);
    return num === undefined || abstract === undefined ? null : { num, levels: levelsOf(num.abstractNumId, abstract) };
  };

  const used = new Map<string, string>();
  const checked = new Set<string>();
  const counters = new Map<string, Counters>();
  return {
    refOf(numId) {
      const list = listOf(numId);
      if (list === null) return null;
      const reference = `list-${ctx.ordinals("abstractNum", list.num.abstractNumId)}`;
      used.set(reference, list.num.abstractNumId);
      if (!checked.has(numId)) {
        checked.add(numId);
        for (const override of list.num.overrides.filter((o) => !isWriterOverride(o, list.levels))) {
          const detail = `numId ${numId}, level ${attrOf(override, "w:ilvl") ?? "?"}: docx.js writes only its own level-0 start override, so the list keeps its abstract levels`;
          here.report({ kind: "dropped", element: override.name, detail });
        }
      }
      return { reference, instance: instanceOf(ctx.ordinals, reference, numId) };
    },
    config() {
      return [...used].map(([reference, abstractNumId]) => ({ reference, levels: levels.get(abstractNumId) ?? [] }));
    },
    reportUnused() {
      const usedIds = new Set(used.values());
      for (const id of abstracts.keys()) if (!usedIds.has(id)) ctx.ignore("w:abstractNum");
    },
    markerOf(numId, level, at) {
      const list = listOf(numId);
      if (list === null) return null;
      for (const format of decimalFormats(list.levels, level)) {
        at.report({ kind: "resolved", element: "w:numFmt", detail: `${format} shown as decimal` });
      }
      const partCounters = counters.get(at.part) ?? new Map<string, number[]>();
      counters.set(at.part, partCounters);
      const text = markerText(list.levels, partCounters, `${list.num.abstractNumId}:${numId}`, level);
      return { text, level: levelOf(list.levels, level) };
    },
  };
}
