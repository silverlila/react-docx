/** Computed formatting → React inline styles. Lengths are written in pt, colours as "#hex". */

import type { CSSProperties } from "react";
import type { ComputedBorder, ComputedParagraph, ComputedRun } from "./resolve";

/** docx.js underline types → the CSS line style closest to each. */
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

const pt = (n: number): string => `${n}pt`;

/** A CSS font-family value: the name quoted, with no fallback list. */
const fontFamily = (name: string): string => `"${name.replace(/["\\]/g, "\\$&")}"`;

function textDecoration(r: ComputedRun): CSSProperties {
  const lines = [...(r.underline === null ? [] : ["underline"]), ...(r.strike || r.doubleStrike ? ["line-through"] : [])];
  if (lines.length === 0) return { textDecorationLine: "none" };
  const style =
    r.underline !== null && Object.prototype.hasOwnProperty.call(UNDERLINE_STYLES, r.underline)
      ? UNDERLINE_STYLES[r.underline]
      : r.doubleStrike
        ? "double"
        : "solid";
  return { textDecorationLine: lines.join(" "), textDecorationStyle: style };
}

export function runStyle(r: ComputedRun): CSSProperties {
  const background = r.highlight ?? r.background;
  return {
    fontFamily: fontFamily(r.fontFamily),
    fontSize: pt(r.sizePt),
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
  };
}

export function borderCss(b: ComputedBorder): string {
  return `${pt(b.widthPt)} ${b.style} #${b.color}`;
}

function lineHeight(p: ComputedParagraph): CSSProperties["lineHeight"] {
  // CSS has no "at least" line height, so atLeast is drawn as exact.
  return p.lineHeight.kind === "multiple" ? p.lineHeight.value : pt(p.lineHeight.pt);
}

/** The paragraph's box. Its font is the paragraph mark's, so an empty paragraph is as tall as in Word. */
export function paragraphStyle(p: ComputedParagraph): CSSProperties {
  const { top, bottom, left, right } = p.borders;
  return {
    margin: 0,
    marginTop: pt(p.spaceBeforePt),
    marginBottom: pt(p.spaceAfterPt),
    marginLeft: pt(p.indentLeftPt),
    marginRight: pt(p.indentRightPt),
    textIndent: pt(p.firstLinePt),
    textAlign: p.align,
    lineHeight: lineHeight(p),
    fontFamily: fontFamily(p.markRun.fontFamily),
    fontSize: pt(p.markRun.sizePt),
    ...(top === undefined ? {} : { borderTop: borderCss(top) }),
    ...(bottom === undefined ? {} : { borderBottom: borderCss(bottom) }),
    ...(left === undefined ? {} : { borderLeft: borderCss(left) }),
    ...(right === undefined ? {} : { borderRight: borderCss(right) }),
    ...(p.background === null ? {} : { backgroundColor: `#${p.background}` }),
    ...(p.pageBreakBefore ? { breakBefore: "page" } : {}),
  };
}
