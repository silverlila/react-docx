/** What the preview knows about a font by name: Word's single line height for it, and a CSS fallback list
 *  for a browser that does not have it.
 *
 *  - Word sets a single-spaced line at the font's own height: (win ascent + win descent + external
 *    leading) / units per em, where the external leading is whatever the hhea line gap adds beyond the
 *    win metrics. LINE_HEIGHTS holds that ratio for the fonts Word documents use most, measured from the
 *    fonts' files (Times New Roman from Windows' copy, whose line gap Mac Word's copy lacks). Other fonts
 *    get DEFAULT_LINE_HEIGHT, Times New Roman's and Arial's.
 *  - The fallback list puts a metric-compatible substitute first where one exists (Carlito for Calibri,
 *    Liberation for Arial, Times New Roman and Courier New, Caladea for Cambria), then a generic family
 *    guessed from the name. */

import { own } from "../schema/own";

const LINE_HEIGHTS: Readonly<Record<string, number>> = {
  "Angsana New": 1.3508,
  Aptos: 1.2847,
  "Aptos Display": 1.2847,
  "Aptos Narrow": 1.2847,
  Arial: 1.1499,
  "Arial Black": 1.4102,
  "Arial Narrow": 1.1475,
  "Baskerville Old Face": 1.1406,
  Batang: 1.1484,
  "Bell MT": 1.1118,
  "Book Antiqua": 1.2427,
  "Bookman Old Style": 1.1738,
  Calibri: 1.2207,
  "Calibri Light": 1.2207,
  "Calisto MT": 1.1543,
  Cambria: 1.1724,
  Candara: 1.2207,
  Century: 1.2021,
  "Century Gothic": 1.2261,
  "Century Schoolbook": 1.2021,
  "Comic Sans MS": 1.3936,
  Consolas: 1.1709,
  Constantia: 1.2207,
  Corbel: 1.2207,
  "Cordia New": 1.3862,
  "Courier New": 1.1328,
  "Franklin Gothic Book": 1.1338,
  "Franklin Gothic Medium": 1.1338,
  Garamond: 1.125,
  Georgia: 1.1362,
  "Gill Sans MT": 1.1597,
  "Goudy Old Style": 1.2002,
  Gulim: 1.1484,
  Helvetica: 1.1753,
  "Helvetica Neue": 1.193,
  Impact: 1.2197,
  "Lucida Console": 1.0,
  "Lucida Sans": 1.1777,
  "Lucida Sans Unicode": 1.5366,
  "Malgun Gothic": 1.3301,
  Meiryo: 1.5,
  "Microsoft YaHei": 1.3198,
  "MS Gothic": 1.0,
  "MS Mincho": 1.0,
  "Palatino Linotype": 1.3491,
  Perpetua: 1.146,
  Rockwell: 1.3179,
  "Segoe UI": 1.33,
  SimSun: 1.1406,
  Symbol: 1.2251,
  Tahoma: 1.207,
  "Times New Roman": 1.1499,
  "Trebuchet MS": 1.1611,
  "Tw Cen MT": 1.0889,
  Verdana: 1.2153,
  Wingdings: 1.1099,
};

const DEFAULT_LINE_HEIGHT = 1.15;

const SUBSTITUTES: Readonly<Record<string, readonly string[]>> = {
  Calibri: ["Carlito"],
  "Calibri Light": ["Carlito"],
  Cambria: ["Caladea"],
  Arial: ["Liberation Sans", "Arimo", "Helvetica"],
  Helvetica: ["Arial", "Liberation Sans"],
  "Times New Roman": ["Liberation Serif", "Tinos", "Times"],
  "Courier New": ["Liberation Mono", "Cousine", "Courier"],
  "Book Antiqua": ["Palatino Linotype", "Palatino"],
  "Palatino Linotype": ["Palatino", "Book Antiqua"],
  "Segoe UI": ["system-ui"],
};

const MONOSPACE = /mono|courier|consol|code|typewriter|menlo|monaco/i;
const SERIF =
  /(?<!sans[ -]?)serif|times|roman|garamond|georgia|cambria|antiqua|bookman|baskerville|caslon|didot|bodoni|palatino|minion|merriweather|playfair|lora|century|constantia|perpetua|goudy|calisto|bell mt|mincho|batang|song|sun\b|ming|david|traditional arabic|nazanin|lotus|mitra|zar|naskh/i;

/** Word's single line height for `font`, as a multiple of its size. */
export function lineHeightOf(font: string): number {
  return own(LINE_HEIGHTS, font) ?? DEFAULT_LINE_HEIGHT;
}

function genericFamily(font: string): string {
  if (MONOSPACE.test(font)) return "monospace";
  return SERIF.test(font) ? "serif" : "sans-serif";
}

const quoted = (name: string): string => (name === "system-ui" ? name : `"${name.replace(/["\\]/g, "\\$&")}"`);

/** A CSS font-family list for `fonts`, the run's fonts in Word's order of preference. */
export function fontFamilyCss(fonts: readonly string[]): string {
  const names: string[] = [];
  for (const font of fonts) {
    for (const name of [font, ...(own(SUBSTITUTES, font) ?? [])]) if (!names.includes(name)) names.push(name);
  }
  return [...names.map(quoted), genericFamily(fonts[0] ?? "")].join(", ");
}
