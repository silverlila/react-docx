/** The codec framework: what every OOXML property codec (w:rPr, w:pPr, w:tblPr, …) shares.
 *
 *  - A codec turns one property element into docx.js options plus notes. Each child element has a fate
 *    (decision 6): mapped to an option, ignored as editing noise, or dropped because docx.js cannot write
 *    it. A child the fate table does not name is dropped. Attributes of the property element itself are
 *    never fates.
 *  - Theme colours resolve to literal hex (decision 9). Word writes the computed colour beside a theme
 *    reference, so a hex value is taken as it is, with no note. The theme is read only when the value is
 *    absent or "auto": tint is c·t + 255·(1−t) and shade is c·s, with t and s the hex byte / 255.
 *  - "auto" stays "auto", which docx.js writes back verbatim.
 *  - Values docx.js types as a closed set (BorderStyle, ShadingType, …) are checked against that set, and
 *    a value outside it is dropped with a note.
 *  - Shared sub-codecs: one border side (w:bdr, w:top, …) and shading (w:shd). They live here because run,
 *    paragraph and table properties all use them.
 *  - Codecs import docx only as types, because the HTML bundle uses them (decision 15). */

import type * as docx from "docx";
import { attrOf, elementsOf, isOn, type XmlElement } from "./xml";

export type ThemeFontSet = {
  readonly latin: string | null;
  readonly eastAsia: string | null;
  readonly complex: string | null;
};

export type ThemeFonts = { readonly major: ThemeFontSet; readonly minor: ThemeFontSet };

/** Word theme colour names → 6-digit hex. Keys: dk1 lt1 dk2 lt2 accent1–6 hlink folHlink. */
export type ThemeColors = Readonly<Record<string, string>>;

export type Theme = { readonly fonts: ThemeFonts; readonly colors: ThemeColors };

export type CodecEnv = { readonly theme: Theme };

export type Note = {
  readonly fate: "resolved" | "dropped" | "ignored";
  readonly element: string;
  readonly detail: string;
};

export type CodecResult<T> = { readonly options: T; readonly notes: readonly Note[] };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The options object a codec builds before returning it as T. */
export type Draft<T> = Partial<Mutable<T>>;

/** How one OOXML child element is handled. `read` writes into the options being built and may push notes. */
export type Fate<T> =
  | { readonly fate: "mapped"; readonly read: (el: XmlElement, out: Draft<T>, env: CodecEnv, notes: Note[]) => void }
  | { readonly fate: "ignored" }
  | { readonly fate: "dropped"; readonly why: string };

/** Keyed by qualified child name. */
export type FateTable<T> = Readonly<Record<string, Fate<T>>>;

/** Reads one option value from an element, or null when there is nothing to set (with a note if that loses
 *  something). */
export type ValueReader<V> = (el: XmlElement, env: CodecEnv, notes: Note[]) => V | null;

export type ValueOf<T> = T[keyof T];
type BorderStyle = ValueOf<typeof docx.BorderStyle>;
type ShadingType = ValueOf<typeof docx.ShadingType>;

const NO_OPTION = "docx.js has no option for it";
const OFF_VALUES = ["0", "false", "off"];
const HEX = /^[0-9A-Fa-f]{6}$/;
const HEX_BYTE = /^[0-9A-Fa-f]{2}$/;
const WHOLE_NUMBER = /^-?[0-9]+$/;

export const dropped = (element: string, detail: string): Note => ({ fate: "dropped", element, detail });

export const noOption = (why: string) => ({ fate: "dropped", why }) as const;

const UNIVERSAL_MEASURE = /^-?[0-9]+(\.[0-9]+)?(mm|cm|in|pt|pc|pi)$/;
export const isUniversalMeasure = (value: string): value is docx.UniversalMeasure => UNIVERSAL_MEASURE.test(value);

export const ALIGNMENTS: readonly ValueOf<typeof docx.AlignmentType>[] = [
  "start",
  "center",
  "end",
  "both",
  "mediumKashida",
  "distribute",
  "numTab",
  "highKashida",
  "lowKashida",
  "thaiDistribute",
  "left",
  "right",
];

export const HEIGHT_RULES: readonly ValueOf<typeof docx.HeightRule>[] = ["auto", "atLeast", "exact"];

export const resolved = (element: string, detail: string): Note => ({ fate: "resolved", element, detail });

export function applyFates<T>(
  el: XmlElement | null,
  table: FateTable<T>,
  env: CodecEnv
): { readonly options: Draft<T>; readonly notes: Note[] } {
  const options: Draft<T> = {};
  const notes: Note[] = [];
  for (const child of elementsOf(el)) {
    const fate = Object.prototype.hasOwnProperty.call(table, child.name) ? table[child.name] : undefined;
    if (fate === undefined) {
      notes.push(dropped(child.name, NO_OPTION));
      continue;
    }
    switch (fate.fate) {
      case "mapped":
        fate.read(child, options, env, notes);
        break;
      case "ignored":
        notes.push({ fate: "ignored", element: child.name, detail: "editing noise Word recomputes" });
        break;
      case "dropped":
        notes.push(dropped(child.name, fate.why));
        break;
      default: {
        const exhaustive: never = fate;
        throw new Error(`applyFates: unknown fate ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return { options, notes };
}

/** A fate that sets `key` to what `read` returns, unless it returns null. */
export function mapTo<T, K extends keyof T>(key: K, read: ValueReader<NonNullable<Draft<T>[K]>>): Fate<T> {
  return {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const value = read(el, env, notes);
      if (value !== null) out[key] = value;
    },
  };
}

export const isOneOf = <V extends string>(values: readonly V[], value: string): value is V =>
  values.some((member) => member === value);

export const isOnValue = (value: string): boolean => !OFF_VALUES.includes(value);

/** A CT_OnOff element read with isOn. When docx.js cannot write it off, an off value is dropped. */
export const onOff =
  (offIsWritable: boolean): ValueReader<boolean> =>
  (el, _env, notes) => {
    const on = isOn(el);
    if (on || offIsWritable) return on;
    notes.push(dropped(el.name, "explicit off is not expressible in docx.js"));
    return null;
  };

export function wholeNumberAt(el: XmlElement, attribute: string, notes: Note[]): number | null {
  const value = attrOf(el, attribute);
  if (value === null) return null;
  if (WHOLE_NUMBER.test(value)) return Number(value);
  notes.push(dropped(el.name, `${attribute}="${value}" is not a whole number`));
  return null;
}

export function oneOfAt<V extends string>(el: XmlElement, attribute: string, values: readonly V[], notes: Note[]): V | null {
  const value = attrOf(el, attribute);
  if (value === null) return null;
  if (isOneOf(values, value)) return value;
  notes.push(dropped(el.name, `${attribute}="${value}" is not a value docx.js accepts`));
  return null;
}

function requiredVal(el: XmlElement, notes: Note[]): string | null {
  const value = attrOf(el, "w:val");
  if (value === null) notes.push(dropped(el.name, "it has no w:val"));
  return value;
}

export const stringVal: ValueReader<string> = (el, _env, notes) => requiredVal(el, notes);

export const wholeNumberVal: ValueReader<number> = (el, _env, notes) =>
  requiredVal(el, notes) === null ? null : wholeNumberAt(el, "w:val", notes);

export const oneOfVal =
  <V extends string>(values: readonly V[]): ValueReader<V> =>
  (el, _env, notes) =>
    requiredVal(el, notes) === null ? null : oneOfAt(el, "w:val", values, notes);

/** themeColor → clrScheme key. */
export const THEME_COLOR_KEYS: Readonly<Record<string, string>> = {
  dark1: "dk1",
  text1: "dk1",
  light1: "lt1",
  background1: "lt1",
  dark2: "dk2",
  text2: "dk2",
  light2: "lt2",
  background2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hyperlink: "hlink",
  followedHyperlink: "folHlink",
};

/** The attribute holding a colour's hex, and the theme attributes that go with it. */
const COLOR_SOURCES = {
  "w:val": { theme: "w:themeColor", tint: "w:themeTint", shade: "w:themeShade" },
  "w:color": { theme: "w:themeColor", tint: "w:themeTint", shade: "w:themeShade" },
  "w:fill": { theme: "w:themeFill", tint: "w:themeFillTint", shade: "w:themeFillShade" },
} as const;

export type ColorSource = keyof typeof COLOR_SOURCES;

function byteFraction(hex: string | null): number | null {
  return hex !== null && HEX_BYTE.test(hex) ? parseInt(hex, 16) / 255 : null;
}

function mapChannels(hex: string, map: (channel: number) => number): string {
  let out = "";
  for (let i = 0; i < 6; i += 2) {
    const channel = Math.min(255, Math.max(0, Math.round(map(parseInt(hex.slice(i, i + 2), 16)))));
    out += channel.toString(16).padStart(2, "0").toUpperCase();
  }
  return out;
}

function themeHex(base: string, tint: string | null, shade: string | null): string {
  const t = byteFraction(tint);
  const s = byteFraction(shade);
  const tinted = t === null ? base : mapChannels(base, (c) => c * t + 255 * (1 - t));
  return s === null ? tinted : mapChannels(tinted, (c) => c * s);
}

/** The colour held by `source` (w:val by default): its hex; else, when absent or "auto", the theme colour
 *  named beside it with tint and shade applied, with a "resolved" note; else "auto"; else null. */
export function colorOf(el: XmlElement, env: CodecEnv, notes: Note[], source: ColorSource = "w:val"): string | null {
  const value = attrOf(el, source);
  if (value !== null && HEX.test(value)) return value;
  const { theme, tint, shade } = COLOR_SOURCES[source];
  const themeColor = attrOf(el, theme);
  if (themeColor !== null) {
    const key = Object.prototype.hasOwnProperty.call(THEME_COLOR_KEYS, themeColor) ? THEME_COLOR_KEYS[themeColor] : null;
    const base = key !== null && Object.prototype.hasOwnProperty.call(env.theme.colors, key) ? env.theme.colors[key] : null;
    if (base !== null && HEX.test(base)) {
      const hex = themeHex(base, attrOf(el, tint), attrOf(el, shade));
      notes.push(resolved(el.name, `${theme}="${themeColor}" → ${hex}`));
      return hex;
    }
    notes.push(dropped(el.name, `${theme}="${themeColor}" is not in the file's theme`));
  }
  if (value === "auto") return "auto";
  if (value !== null) notes.push(dropped(el.name, `${source}="${value}" is not a hex colour`));
  return null;
}

const BORDER_STYLES: readonly BorderStyle[] = [
  "single",
  "dashDotStroked",
  "dashed",
  "dashSmallGap",
  "dotDash",
  "dotDotDash",
  "dotted",
  "double",
  "doubleWave",
  "inset",
  "nil",
  "none",
  "outset",
  "thick",
  "thickThinLargeGap",
  "thickThinMediumGap",
  "thickThinSmallGap",
  "thinThickLargeGap",
  "thinThickMediumGap",
  "thinThickSmallGap",
  "thinThickThinLargeGap",
  "thinThickThinMediumGap",
  "thinThickThinSmallGap",
  "threeDEmboss",
  "threeDEngrave",
  "triple",
  "wave",
];

const SHADING_TYPES: readonly ShadingType[] = [
  "clear",
  "diagCross",
  "diagStripe",
  "horzCross",
  "horzStripe",
  "nil",
  "pct5",
  "pct10",
  "pct12",
  "pct15",
  "pct20",
  "pct25",
  "pct30",
  "pct35",
  "pct37",
  "pct40",
  "pct45",
  "pct50",
  "pct55",
  "pct60",
  "pct62",
  "pct65",
  "pct70",
  "pct75",
  "pct80",
  "pct85",
  "pct87",
  "pct90",
  "pct95",
  "reverseDiagStripe",
  "solid",
  "thinDiagCross",
  "thinDiagStripe",
  "thinHorzCross",
  "thinReverseDiagStripe",
  "thinVertStripe",
  "vertStripe",
];

/** One border side: { style: w:val, color, size: w:sz, space: w:space }, or null (with a note) when its
 *  style is missing or not one docx.js accepts. */
export function readBorder(side: XmlElement, env: CodecEnv, notes: Note[]): docx.IBorderOptions | null {
  const style = oneOfAt(side, "w:val", BORDER_STYLES, notes);
  if (style === null) {
    if (attrOf(side, "w:val") === null) notes.push(dropped(side.name, "it has no w:val"));
    return null;
  }
  const border: Mutable<docx.IBorderOptions> = { style };
  const color = colorOf(side, env, notes, "w:color");
  if (color !== null) border.color = color;
  const size = wholeNumberAt(side, "w:sz", notes);
  if (size !== null) border.size = size;
  const space = wholeNumberAt(side, "w:space", notes);
  if (space !== null) border.space = space;
  return border;
}

/** w:shd: { type: w:val, fill: w:fill, color: w:color }, each colour hex or resolved from the theme. */
export function readShading(shd: XmlElement, env: CodecEnv, notes: Note[]): docx.IShadingAttributesProperties {
  const shading: Mutable<docx.IShadingAttributesProperties> = {};
  const type = oneOfAt(shd, "w:val", SHADING_TYPES, notes);
  if (type !== null) shading.type = type;
  const fill = colorOf(shd, env, notes, "w:fill");
  if (fill !== null) shading.fill = fill;
  const color = colorOf(shd, env, notes, "w:color");
  if (color !== null) shading.color = color;
  return shading;
}
