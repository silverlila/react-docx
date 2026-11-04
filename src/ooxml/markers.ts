/** List marker text: what Word shows in front of a numbered paragraph, from its numbering level's lvlText
 *  and the running count of each level. The reader writes it as literal text where docx.js cannot keep the
 *  numbering (headers and footers), and the HTML resolver draws it.
 *
 *  - A level's count starts at its `start` (default 1). Advancing a level resets every deeper level, so the
 *    next item there starts again.
 *  - In lvlText, `%n` (1-based) is level n−1's current count in level n−1's format; a level not counted yet
 *    shows its start. A `bullet` level's lvlText is the bullet itself and is shown as it is.
 *  - Letters repeat as Word repeats them: 27 is "aa", 28 is "bb". Formats not in NUMBER_FORMATS render as
 *    decimal; `decimalFormats` tells the caller which, so it can report them. */

import type * as docx from "docx";
import { isOwnKey } from "../schema/own";

/** Running counts: `${reference}:${instance}` → the count per level. */
export type Counters = Map<string, number[]>;

/** A `%n` placeholder in lvlText; the group is n. Stateless use only (`matchAll`, `replace`). */
export const LEVEL_NUMBER = /%([1-9])/g;
const ROMAN: readonly (readonly [number, string])[] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out;
}

function letter(n: number): string {
  const index = (n - 1) % 26;
  return String.fromCharCode(97 + index).repeat(Math.floor((n - 1) / 26) + 1);
}

const ORDINAL_SUFFIXES: Readonly<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };

function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${ORDINAL_SUFFIXES[n % 10] ?? "th"}`;
}

/** Each format the marker text can show, by its w:numFmt value. */
const NUMBER_FORMATS: Readonly<Record<string, (n: number) => string>> = {
  decimal: (n) => String(n),
  decimalZero: (n) => (n < 10 ? `0${n}` : String(n)),
  lowerLetter: (n) => (n > 0 ? letter(n) : String(n)),
  upperLetter: (n) => (n > 0 ? letter(n).toUpperCase() : String(n)),
  lowerRoman: (n) => (n > 0 ? roman(n) : String(n)),
  upperRoman: (n) => (n > 0 ? roman(n).toUpperCase() : String(n)),
  ordinal,
  bullet: () => "",
  none: () => "",
};

export function formatNumber(n: number, format: string): string {
  return isOwnKey(NUMBER_FORMATS, format) ? NUMBER_FORMATS[format](n) : String(n);
}

export const levelOf = (levels: readonly docx.ILevelsOptions[], level: number): docx.ILevelsOptions | undefined =>
  levels.find((l) => l.level === level);

/** The formats of the numbers a level's marker shows that markerText renders as decimal. */
export function decimalFormats(levels: readonly docx.ILevelsOptions[], level: number): string[] {
  const own = levelOf(levels, level);
  if (own === undefined || own.format === "bullet") return [];
  return [...(own.text ?? "").matchAll(LEVEL_NUMBER)]
    .map(([, n]) => levelOf(levels, Number(n) - 1)?.format ?? "decimal")
    .filter((format) => !isOwnKey(NUMBER_FORMATS, format));
}

/** Advances the counter for (key, level), resets deeper levels, and renders the level's lvlText. */
export function markerText(levels: readonly docx.ILevelsOptions[], counters: Counters, key: string, level: number): string {
  const startOf = (n: number): number => levelOf(levels, n)?.start ?? 1;
  const counts = counters.get(key) ?? [];
  counts[level] = counts[level] === undefined ? startOf(level) : counts[level] + 1;
  counts.length = level + 1;
  counters.set(key, counts);
  const own = levelOf(levels, level);
  if (own?.format === "bullet") return own.text ?? "";
  return (own?.text ?? "").replace(LEVEL_NUMBER, (_, n: string) => {
    const shown = Number(n) - 1;
    return formatNumber(counts[shown] ?? startOf(shown), levelOf(levels, shown)?.format ?? "decimal");
  });
}
