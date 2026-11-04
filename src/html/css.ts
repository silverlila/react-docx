/** Word's layout rules the CSS reproduces:
 *
 *  - Right to left: a paragraph's indents are logical (Word's left indent is the start), its borders
 *    physical.
 *  - Line height: Word sets a line at its tallest run, as CSS sets a line box at its tallest inline box,
 *    so each run carries its own line height and the paragraph's box carries the paragraph mark's. An
 *    atLeast line is the paragraph's minimum with each run at its single height; an exact line is the
 *    paragraph's, inherited by every run.
 *  - A paragraph's box takes the paragraph mark's font, so an empty paragraph is as tall as in Word.
 *  - pageBreakBefore sets no CSS break: Word ignores it in table cells, headers and footers.
 *  - Superscript and subscript are about two thirds of the run's size and do not make their line taller.
 *  - Space before and after is padding, not margin: Word adds one paragraph's space after to the next
 *    one's space before instead of collapsing them, and its shading and borders take in the spacing. */

import type { CSSProperties } from "react";
import { isOwnKey } from "../schema/own";
import { fontFamilyCss, lineHeightOf } from "./fonts";
import type { ComputedBorder, ComputedParagraph, ComputedRun } from "./model";

const UNDERLINE_STYLES: Readonly<Record<string, CSSProperties["textDecorationStyle"]>> = {
  double: "double",
  wavyDouble: "double",
  dotted: "dotted",
  dottedHeavy: "dotted",
  dash: "dashed",
  dashedHeavy: "dashed",
  dashLong: "dashed",
  dashLongHeavy: "dashed",
  dotDash: "dashed",
  dashDotHeavy: "dashed",
  dotDotDash: "dashed",
  dashDotDotHeavy: "dashed",
  wave: "wavy",
  wavyHeavy: "wavy",
};

export const pt = (n: number): string => `${n}pt`;

const SCRIPT_SCALE = 0.65;

function textDecoration(r: ComputedRun): CSSProperties {
  const lines = [...(r.underline === null ? [] : ["underline"]), ...(r.strike || r.doubleStrike ? ["line-through"] : [])];
  if (lines.length === 0) return { textDecorationLine: "none" };
  const style =
    r.underline !== null && isOwnKey(UNDERLINE_STYLES, r.underline)
      ? UNDERLINE_STYLES[r.underline]
      : r.doubleStrike
        ? "double"
        : "solid";
  return { textDecorationLine: lines.join(" "), textDecorationStyle: style };
}

export function runStyle(r: ComputedRun): CSSProperties {
  const background = r.highlight ?? r.background;
  return {
    fontFamily: fontFamilyCss([r.fontFamily, ...r.otherFonts]),
    ...(r.rtl ? { direction: "rtl", unicodeBidi: "embed" } : {}),
    fontSize: pt(r.verticalAlign === null ? r.sizePt : r.sizePt * SCRIPT_SCALE),
    fontWeight: r.bold ? "bold" : "normal",
    fontStyle: r.italic ? "italic" : "normal",
    ...textDecoration(r),
    ...(r.color === null ? {} : { color: `#${r.color}` }),
    ...(background === null ? {} : { backgroundColor: `#${background}` }),
    ...(r.allCaps ? { textTransform: "uppercase" } : {}),
    ...(r.smallCaps ? { fontVariant: "small-caps" } : {}),
    ...(r.verticalAlign === null ? {} : { verticalAlign: r.verticalAlign }),
    ...(r.letterSpacingPt === 0 ? {} : { letterSpacing: pt(r.letterSpacingPt) }),
    ...(r.hidden ? { display: "none" } : {}),
    ...(r.lineHeight === null ? {} : { lineHeight: r.lineHeight }),
    ...(r.verticalAlign === null ? {} : { lineHeight: 0 }),
  };
}

export function borderCss(b: ComputedBorder): string {
  return `${pt(b.widthPt)} ${b.style} #${b.color}`;
}

function lineHeight(p: ComputedParagraph): CSSProperties["lineHeight"] {
  const line = p.lineHeight;
  return line.kind === "multiple" ? line.value * lineHeightOf(p.markRun.fontFamily) : pt(line.pt);
}

const spacing = (p: ComputedParagraph): CSSProperties => ({ paddingTop: pt(p.spaceBeforePt), paddingBottom: pt(p.spaceAfterPt) });

export function paragraphStyle(p: ComputedParagraph): CSSProperties {
  const { top, bottom, left, right } = p.borders;
  return {
    margin: 0,
    ...spacing(p),
    marginInlineStart: pt(p.indentLeftPt),
    marginInlineEnd: pt(p.indentRightPt),
    ...(p.rtl ? { direction: "rtl" } : {}),
    textIndent: pt(p.firstLinePt),
    textAlign: p.align,
    lineHeight: lineHeight(p),
    fontFamily: fontFamilyCss([p.markRun.fontFamily, ...p.markRun.otherFonts]),
    fontSize: pt(p.markRun.sizePt),
    ...(top === undefined ? {} : { borderTop: borderCss(top) }),
    ...(bottom === undefined ? {} : { borderBottom: borderCss(bottom) }),
    ...(left === undefined ? {} : { borderLeft: borderCss(left) }),
    ...(right === undefined ? {} : { borderRight: borderCss(right) }),
    ...(p.background === null ? {} : { backgroundColor: `#${p.background}` }),
  };
}
