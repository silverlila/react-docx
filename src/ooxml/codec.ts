/** The codec framework every OOXML property codec (w:rPr, w:pPr, w:tblPr, …) shares, plus the border-side
 *  and shading readers that run, paragraph and table properties all use.
 *
 *  - docx.js types BorderStyle, ShadingType, … as closed sets, so a value outside the set is dropped with a note.
 *  - Word writes the computed colour beside a theme reference. Applying a theme colour's tint gives
 *    c·t + 255·(1−t) and its shade gives c·s, with t and s the hex byte / 255.
 *  - docx.js's twipsMeasureValue throws on a negative number.
 *  - Codecs import docx as types only, because the HTML bundle uses them. */

import type * as docx from "docx";
import { own } from "../schema/own";
import { attrOf, elementsOf, isOn, type XmlElement } from "./xml";

export type ThemeFontSet = {
  readonly latin: string | null;
  readonly eastAsia: string | null;
  readonly complex: string | null;
};

export type ThemeFonts = { readonly major: ThemeFontSet; readonly minor: ThemeFontSet };

export type ThemeColors = Readonly<Record<string, string>>;

export type Theme = { readonly fonts: ThemeFonts; readonly colors: ThemeColors };

export type CodecEnv = {
  readonly theme: Theme;
  readonly styleIds?: ReadonlyMap<string, string>;
  readonly tableStyleBorders?: ReadonlyMap<string, docx.ITableBordersOptions>;
};

const NO_FONTS: ThemeFontSet = { latin: null, eastAsia: null, complex: null };

export const NO_THEME_ENV: CodecEnv = { theme: { fonts: { major: NO_FONTS, minor: NO_FONTS }, colors: {} } };

export type Note = {
  readonly fate: "resolved" | "dropped" | "ignored";
  readonly element: string;
  readonly detail: string;
};

export type CodecResult<T> = { readonly options: T; readonly notes: readonly Note[] };

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type Draft<T> = Partial<Mutable<T>>;

export type Fate<T> =
  | { readonly fate: "mapped"; readonly read: (el: XmlElement, out: Draft<T>, env: CodecEnv, notes: Note[]) => void }
  | { readonly fate: "ignored" }
  | { readonly fate: "dropped"; readonly why: string };

export type FateTable<T> = Readonly<Record<string, Fate<T>>>;

export type ValueReader<V> = (el: XmlElement, env: CodecEnv, notes: Note[]) => V | null;

export type ValueOf<T> = T[keyof T];
type BorderStyle = ValueOf<typeof docx.BorderStyle>;
type ShadingType = ValueOf<typeof docx.ShadingType>;

export const NO_OPTION = "docx.js has no option for it";
const OFF_VALUES = ["0", "false", "off"];
export const HEX = /^[0-9A-Fa-f]{6}$/;
const HEX_BYTE = /^[0-9A-Fa-f]{2}$/;
export const INTEGER = /^-?[0-9]+$/;
export const WHOLE_NUMBER = /^[0-9]+$/;
export const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

export const dropped = (element: string, detail: string): Note => ({ fate: "dropped", element, detail });

export const noOption = (why: string) => ({ fate: "dropped", why }) as const;

export const HANDLED_BESIDE = { fate: "mapped", read: () => undefined } as const;

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

export const NUMBER_FORMATS: readonly ValueOf<typeof docx.NumberFormat>[] = [
  "decimal",
  "upperRoman",
  "lowerRoman",
  "upperLetter",
  "lowerLetter",
  "ordinal",
  "cardinalText",
  "ordinalText",
  "hex",
  "chicago",
  "ideographDigital",
  "japaneseCounting",
  "aiueo",
  "iroha",
  "decimalFullWidth",
  "decimalHalfWidth",
  "japaneseLegal",
  "japaneseDigitalTenThousand",
  "decimalEnclosedCircle",
  "decimalFullWidth2",
  "aiueoFullWidth",
  "irohaFullWidth",
  "decimalZero",
  "bullet",
  "ganada",
  "chosung",
  "decimalEnclosedFullstop",
  "decimalEnclosedParen",
  "decimalEnclosedCircleChinese",
  "ideographEnclosedCircle",
  "ideographTraditional",
  "ideographZodiac",
  "ideographZodiacTraditional",
  "taiwaneseCounting",
  "ideographLegalTraditional",
  "taiwaneseCountingThousand",
  "taiwaneseDigital",
  "chineseCounting",
  "chineseLegalSimplified",
  "chineseCountingThousand",
  "koreanDigital",
  "koreanCounting",
  "koreanLegal",
  "koreanDigital2",
  "vietnameseCounting",
  "russianLower",
  "russianUpper",
  "none",
  "numberInDash",
  "hebrew1",
  "hebrew2",
  "arabicAlpha",
  "arabicAbjad",
  "hindiVowels",
  "hindiConsonants",
  "hindiNumbers",
  "hindiCounting",
  "thaiLetters",
  "thaiNumbers",
  "thaiCounting",
  "bahtText",
  "dollarText",
];

export const resolved = (element: string, detail: string): Note => ({ fate: "resolved", element, detail });

export function applyFates<T>(
  el: XmlElement | null,
  table: FateTable<T>,
  env: CodecEnv,
): { readonly options: Draft<T>; readonly notes: Note[] } {
  const options: Draft<T> = {};
  const notes: Note[] = [];
  for (const child of elementsOf(el)) {
    const fate = own(table, child.name);
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
  if (INTEGER.test(value)) return Number(value);
  notes.push(dropped(el.name, `${attribute}="${value}" is not a whole number`));
  return null;
}

export function oneOfAt<V extends string>(
  el: XmlElement,
  attribute: string,
  values: readonly V[],
  notes: Note[],
): V | null {
  const value = attrOf(el, attribute);
  if (value === null) return null;
  if (isOneOf(values, value)) return value;
  notes.push(dropped(el.name, `${attribute}="${value}" is not a value docx.js accepts`));
  return null;
}

export function twipsAt(el: XmlElement, attribute: string, notes: Note[]): number | null {
  const value = wholeNumberAt(el, attribute, notes);
  if (value === null || value >= 0) return value;
  notes.push(dropped(el.name, `${attribute}="${value}" is negative, and docx.js writes only positive twips here`));
  return null;
}

export function requiredAttr(el: XmlElement, attribute: string, notes: Note[]): string | null {
  const value = attrOf(el, attribute);
  if (value === null) notes.push(dropped(el.name, `it has no ${attribute}`));
  return value;
}

export const stringVal: ValueReader<string> = (el, _env, notes) => requiredAttr(el, "w:val", notes);

export const styleRefVal: ValueReader<string> = (el, env, notes) => {
  const id = requiredAttr(el, "w:val", notes);
  return id === null ? null : (env.styleIds?.get(id) ?? id);
};

export const wholeNumberVal: ValueReader<number> = (el, _env, notes) =>
  requiredAttr(el, "w:val", notes) === null ? null : wholeNumberAt(el, "w:val", notes);

export const oneOfVal =
  <V extends string>(values: readonly V[]): ValueReader<V> =>
  (el, _env, notes) =>
    requiredAttr(el, "w:val", notes) === null ? null : oneOfAt(el, "w:val", values, notes);

const THEME_COLOR_KEYS: Readonly<Record<string, string>> = {
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

const COLOR_SOURCES = {
  "w:val": { theme: "w:themeColor", tint: "w:themeTint", shade: "w:themeShade" },
  "w:color": { theme: "w:themeColor", tint: "w:themeTint", shade: "w:themeShade" },
  "w:fill": { theme: "w:themeFill", tint: "w:themeFillTint", shade: "w:themeFillShade" },
} as const;

type ColorSource = keyof typeof COLOR_SOURCES;

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

export function colorOf(el: XmlElement, env: CodecEnv, notes: Note[], source: ColorSource = "w:val"): string | null {
  const value = attrOf(el, source);
  if (value !== null && HEX.test(value)) return value;
  const { theme, tint, shade } = COLOR_SOURCES[source];
  const themeColor = attrOf(el, theme);
  if (themeColor !== null) {
    const key = own(THEME_COLOR_KEYS, themeColor);
    const base = key === undefined ? undefined : own(env.theme.colors, key);
    if (base !== undefined && HEX.test(base)) {
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
