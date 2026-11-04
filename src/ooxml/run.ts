/** w:rPr → docx.js run options (IRunOptions without content).
 *
 *  - The writer-inverse test defines correctness: for options docx.js writes, reading its w:rPr gives
 *    options that docx.js writes identically.
 *  - Complex-script twins (w:bCs, w:iCs, w:szCs, w:highlightCs): docx.js writes each twin equal to its main
 *    option unless the twin option is set, and leaves it out when the twin option is false. So a twin equal
 *    to its main is not kept as an option, and a twin that is off while its main is on becomes `false`
 *    (dropped: the explicit off). A main with no twin is read alone, so docx.js writes the twin beside it,
 *    which changes only complex-script text.
 *  - docx.js writes w:caps only when smallCaps is unset, so with both present w:caps is dropped.
 *  - Off values docx.js cannot write: vanish, specVanish and math, which it writes only when on. These are
 *    dropped.
 *  - w:position: a universal measure ("6pt") is kept verbatim, as docx.js writes it; Word's half-points
 *    ("6") become points ("3pt"), because docx.js types position as a universal measure.
 *  - Fonts: theme font attributes resolve against the file's theme and win over the literal beside them.
 *    The object keeps the file's attribute order, which docx.js writes back. Four equal names and no hint
 *    give the string form. */

import type * as docx from "docx";
import { attrOf, childNamed, type XmlElement } from "./xml";
import {
  applyFates,
  colorOf,
  dropped,
  mapTo,
  oneOfAt,
  oneOfVal,
  onOff,
  readBorder,
  readShading,
  resolved,
  stringVal,
  wholeNumberAt,
  wholeNumberVal,
  isUniversalMeasure,
  noOption,
  type CodecEnv,
  type CodecResult,
  type Draft,
  type FateTable,
  type Note,
  type ThemeFonts,
  type ThemeFontSet,
  type ValueOf,
  type ValueReader,
} from "./codec";

export type RunOptions = Omit<docx.IRunOptions, "children" | "text" | "break">;

type FontKey = "ascii" | "hAnsi" | "eastAsia" | "cs";
type RunFont = string | docx.IFontAttributesProperties;
type RunFlag =
  | "bold"
  | "boldComplexScript"
  | "italics"
  | "italicsComplexScript"
  | "allCaps"
  | "smallCaps"
  | "strike"
  | "doubleStrike"
  | "emboss"
  | "imprint"
  | "noProof"
  | "snapToGrid"
  | "vanish"
  | "specVanish"
  | "rightToLeft"
  | "math";

const WRITTEN_ONLY_WHEN_ON: readonly RunFlag[] = ["vanish", "specVanish", "math"];
const EXPLICIT_OFF = "explicit off is not expressible in docx.js";

const UNDERLINE_TYPES: readonly ValueOf<typeof docx.UnderlineType>[] = [
  "single",
  "words",
  "double",
  "thick",
  "dotted",
  "dottedHeavy",
  "dash",
  "dashedHeavy",
  "dashLong",
  "dashLongHeavy",
  "dotDash",
  "dashDotHeavy",
  "dotDotDash",
  "dashDotDotHeavy",
  "wave",
  "wavyHeavy",
  "wavyDouble",
  "none",
];

const HIGHLIGHT_COLORS: readonly ValueOf<typeof docx.HighlightColor>[] = [
  "black",
  "blue",
  "cyan",
  "darkBlue",
  "darkCyan",
  "darkGray",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "green",
  "lightGray",
  "magenta",
  "none",
  "red",
  "white",
  "yellow",
];

const TEXT_EFFECTS: readonly ValueOf<typeof docx.TextEffect>[] = [
  "blinkBackground",
  "lights",
  "antsBlack",
  "antsRed",
  "shimmer",
  "sparkle",
  "none",
];

const EMPHASIS_MARKS: readonly ValueOf<typeof docx.EmphasisMarkType>[] = ["dot"];

const FONT_ATTRIBUTES = new Map<string, FontKey>([
  ["w:ascii", "ascii"],
  ["w:hAnsi", "hAnsi"],
  ["w:eastAsia", "eastAsia"],
  ["w:cs", "cs"],
]);

const THEME_FONT_ATTRIBUTES = new Map<string, FontKey>([
  ["w:asciiTheme", "ascii"],
  ["w:hAnsiTheme", "hAnsi"],
  ["w:eastAsiaTheme", "eastAsia"],
  ["w:cstheme", "cs"],
]);

/** ST_Theme font values → the theme font scheme and slot they name. */
const THEME_FONTS = new Map<string, readonly [keyof ThemeFonts, keyof ThemeFontSet]>([
  ["majorAscii", ["major", "latin"]],
  ["majorHAnsi", ["major", "latin"]],
  ["majorEastAsia", ["major", "eastAsia"]],
  ["majorBidi", ["major", "complex"]],
  ["minorAscii", ["minor", "latin"]],
  ["minorHAnsi", ["minor", "latin"]],
  ["minorEastAsia", ["minor", "eastAsia"]],
  ["minorBidi", ["minor", "complex"]],
]);


const to = <K extends keyof RunOptions>(key: K, read: ValueReader<NonNullable<Draft<RunOptions>[K]>>) =>
  mapTo<RunOptions, K>(key, read);

const offIsWritable = (key: RunFlag): boolean => !WRITTEN_ONLY_WHEN_ON.includes(key);

const flag = (key: RunFlag) => to(key, onOff(offIsWritable(key)));


/** docx.js writes characterSpacing and kern only when they are not zero. */
const nonZero =
  (read: ValueReader<number>): ValueReader<number> =>
  (el, env, notes) => {
    const value = read(el, env, notes);
    if (value !== 0) return value;
    notes.push(dropped(el.name, "docx.js does not write a zero value"));
    return null;
  };

const readPosition: ValueReader<docx.UniversalMeasure> = (el, _env, notes) => {
  const value = attrOf(el, "w:val");
  if (value !== null && isUniversalMeasure(value)) return value;
  const halfPoints = wholeNumberAt(el, "w:val", notes);
  return halfPoints === null ? null : `${halfPoints / 2}pt`;
};

const readUnderline: ValueReader<NonNullable<RunOptions["underline"]>> = (el, env, notes) => {
  const type = oneOfAt(el, "w:val", UNDERLINE_TYPES, notes);
  if (type === null && attrOf(el, "w:val") !== null) return null;
  const color = colorOf(el, env, notes, "w:color");
  return { ...(type === null ? {} : { type }), ...(color === null ? {} : { color }) };
};

const readLanguage: ValueReader<NonNullable<RunOptions["language"]>> = (el) => {
  const value = attrOf(el, "w:val");
  const eastAsia = attrOf(el, "w:eastAsia");
  const bidirectional = attrOf(el, "w:bidi");
  return {
    ...(value === null ? {} : { value }),
    ...(eastAsia === null ? {} : { eastAsia }),
    ...(bidirectional === null ? {} : { bidirectional }),
  };
};

const readEmphasisMark: ValueReader<NonNullable<RunOptions["emphasisMark"]>> = (el, env, notes) => {
  const type = oneOfVal(EMPHASIS_MARKS)(el, env, notes);
  return type === null ? null : { type };
};

function themeFontName(value: string, fonts: ThemeFonts): string | null {
  const slot = THEME_FONTS.get(value);
  return slot === undefined ? null : fonts[slot[0]][slot[1]];
}

const readFonts: ValueReader<RunFont> = (el, env, notes) => {
  const themed = new Map<FontKey, string>();
  for (const [attribute, key] of THEME_FONT_ATTRIBUTES) {
    const value = attrOf(el, attribute);
    if (value === null) continue;
    const name = themeFontName(value, env.theme.fonts);
    if (name === null) {
      notes.push(dropped(el.name, `${attribute}="${value}" is not in the file's theme`));
    } else {
      themed.set(key, name);
      notes.push(resolved(el.name, `${attribute}="${value}" → ${name}`));
    }
  }

  const font: Draft<docx.IFontAttributesProperties> = {};
  for (const [attribute, value] of Object.entries(el.attributes)) {
    if (attribute === "w:hint") font.hint = value;
    const literal = FONT_ATTRIBUTES.get(attribute);
    if (literal !== undefined && !themed.has(literal)) font[literal] = value;
    const theme = THEME_FONT_ATTRIBUTES.get(attribute);
    const name = theme === undefined ? undefined : themed.get(theme);
    if (theme !== undefined && name !== undefined) font[theme] = name;
  }

  const { ascii } = font;
  const names = [font.ascii, font.hAnsi, font.eastAsia, font.cs];
  if (ascii !== undefined && font.hint === undefined && names.every((name) => name === ascii)) return ascii;
  return Object.keys(font).length === 0 ? null : font;
};

const readRevision: ValueReader<docx.IRunPropertiesChangeOptions> = (el, env, notes) => {
  const id = wholeNumberAt(el, "w:id", notes);
  const author = attrOf(el, "w:author");
  const date = attrOf(el, "w:date");
  if (id === null || author === null || date === null) {
    notes.push(dropped(el.name, "docx.js needs w:id, w:author and w:date"));
    return null;
  }
  const previous = readRunProperties(childNamed(el, "w:rPr"), env);
  notes.push(...previous.notes);
  return { id, author, date, ...previous.options };
};

export const RPR_FATES: FateTable<RunOptions> = {
  "w:rStyle": to("style", stringVal),
  "w:rFonts": to("font", readFonts),
  "w:b": flag("bold"),
  "w:bCs": flag("boldComplexScript"),
  "w:i": flag("italics"),
  "w:iCs": flag("italicsComplexScript"),
  "w:caps": flag("allCaps"),
  "w:smallCaps": flag("smallCaps"),
  "w:strike": flag("strike"),
  "w:dstrike": flag("doubleStrike"),
  "w:outline": noOption("docx.js has no outline option"),
  "w:shadow": noOption("docx.js has no shadow option"),
  "w:emboss": flag("emboss"),
  "w:imprint": flag("imprint"),
  "w:noProof": flag("noProof"),
  "w:snapToGrid": flag("snapToGrid"),
  "w:vanish": flag("vanish"),
  "w:webHidden": noOption("docx.js has no webHidden option"),
  "w:color": to("color", colorOf),
  "w:spacing": to("characterSpacing", nonZero(wholeNumberVal)),
  "w:w": to("scale", wholeNumberVal),
  "w:kern": to("kern", nonZero(wholeNumberVal)),
  "w:position": to("position", readPosition),
  "w:sz": to("size", wholeNumberVal),
  "w:szCs": to("sizeComplexScript", wholeNumberVal),
  "w:highlight": to("highlight", oneOfVal(HIGHLIGHT_COLORS)),
  "w:highlightCs": to("highlightComplexScript", oneOfVal(HIGHLIGHT_COLORS)),
  "w:u": to("underline", readUnderline),
  "w:effect": to("effect", oneOfVal(TEXT_EFFECTS)),
  "w:bdr": to("border", readBorder),
  "w:shd": to("shading", readShading),
  "w:fitText": noOption("docx.js has no fitText option"),
  "w:vertAlign": {
    fate: "mapped",
    read: (el, out, _env, notes) => {
      const value = attrOf(el, "w:val");
      if (value === "superscript") out.superScript = true;
      else if (value === "subscript") out.subScript = true;
      else notes.push(dropped(el.name, `w:val="${value}" is not expressible in docx.js`));
    },
  },
  "w:rtl": flag("rightToLeft"),
  "w:cs": noOption("docx.js has no option for the complex-script flag"),
  "w:em": to("emphasisMark", readEmphasisMark),
  "w:lang": to("language", readLanguage),
  "w:eastAsianLayout": noOption("docx.js has no eastAsianLayout option"),
  "w:specVanish": flag("specVanish"),
  "w:oMath": flag("math"),
  "w:rPrChange": to("revision", readRevision),
};

/** What the twin option should be, given the main and twin values read from the file; undefined omits it. */
function twinOption<V>(main: V | undefined, twin: V | undefined, element: string, notes: Note[]): V | false | undefined {
  if (twin === undefined || twin === main) return undefined;
  if (twin) return twin;
  notes.push(dropped(element, EXPLICIT_OFF));
  return main === undefined ? undefined : false;
}

function settle<K extends keyof RunOptions>(options: Draft<RunOptions>, key: K, value: Draft<RunOptions>[K]): void {
  if (value === undefined) delete options[key];
  else options[key] = value;
}

/** Run properties as an option, or null when there are none: a paragraph mark's or a style's. */
export const readRunOption: ValueReader<RunOptions> = (el, env, notes) => {
  const run = readRunProperties(el, env);
  notes.push(...run.notes);
  return Object.keys(run.options).length === 0 ? null : run.options;
};

export function readRunProperties(rPr: XmlElement | null, env: CodecEnv): CodecResult<RunOptions> {
  const { options, notes } = applyFates(rPr, RPR_FATES, env);
  settle(options, "boldComplexScript", twinOption(options.bold, options.boldComplexScript, "w:bCs", notes));
  settle(options, "italicsComplexScript", twinOption(options.italics, options.italicsComplexScript, "w:iCs", notes));
  settle(options, "sizeComplexScript", twinOption(options.size, options.sizeComplexScript, "w:szCs", notes));
  settle(
    options,
    "highlightComplexScript",
    twinOption(options.highlight, options.highlightComplexScript, "w:highlightCs", notes)
  );
  if (options.smallCaps !== undefined && options.allCaps !== undefined) {
    notes.push(dropped("w:caps", "docx.js writes w:caps only when smallCaps is unset"));
    delete options.allCaps;
  }
  return { options, notes };
}
