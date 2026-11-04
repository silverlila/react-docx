/** Checks that every content class docx.js declares in its index.d.ts is a kind in ELEMENTS or listed
 *  in NOT_MAPPED.
 *
 *  docx.js declares Begin, FieldInstruction, Separate, End and Break but does not export them, so
 *  declared names are filtered against the runtime exports. */

import * as docx from "docx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ELEMENTS } from "../src/schema/elements";

const MATH_SLOTS = "named slots need a slot-component design (out of scope); author as <RawXml> OMML meanwhile";

const NOT_MAPPED: Readonly<Record<string, string>> = {
  Comments: "the comments part container; built from <Comment> children of Document",
  AnnotationReference: "written by docx.js inside comment parts",
  FootnoteReferenceElement: "written by docx.js inside footnote parts",
  Separator: "a footnote separator, written by docx.js",
  ContinuationSeparator: "a footnote continuation separator, written by docx.js",
  EndnoteReference: "docx.js has no endnotes part (out of scope)",
  LastRenderedPageBreak: "a layout cache Word writes and recomputes",
  PageNumberElement: "written by docx.js for PageNumber field values",
  MathFraction: MATH_SLOTS,
  MathSum: MATH_SLOTS,
  MathIntegral: MATH_SLOTS,
  MathSuperScript: MATH_SLOTS,
  MathSubScript: MATH_SLOTS,
  MathSubSuperScript: MATH_SLOTS,
  MathRadical: MATH_SLOTS,
  MathFunction: MATH_SLOTS,
  MathRoundBrackets: MATH_SLOTS,
  MathCurlyBrackets: MATH_SLOTS,
  MathAngledBrackets: MATH_SLOTS,
  MathSquareBrackets: MATH_SLOTS,
};

const declarations = readFileSync(join(createRequire(import.meta.url).resolve("docx"), "../index.d.ts"), "utf8");

function captured(pattern: RegExp, what: string): string {
  const match = declarations.match(pattern);
  if (match === null) throw new Error(`docx.js's index.d.ts no longer declares ${what} as ${pattern}`);
  return match[1];
}

function unionNames(union: string, what: string): string[] {
  return union.split("|").map((term) => {
    const name = term.trim();
    if (!/^\w+$/.test(name)) throw new Error(`${what} has a term that is not a type name: ${name}`);
    return name;
  });
}

function exportAliases(): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const [, declared, exported] of declarations.matchAll(/^export \{ (\w+) as (\w+) \}$/gm)) {
    aliases.set(declared, [...(aliases.get(declared) ?? []), exported]);
  }
  return aliases;
}

const PAGE_NUMBER_TERM = "(typeof PageNumber)[keyof typeof PageNumber]";

function runChildNames(): string[] {
  const union = captured(
    /export declare type IRunOptions = \{\s*readonly children\?: readonly \(([^;]+)\)\[\];/,
    "IRunOptions's children",
  );
  const terms = union.split("|").map((term) => term.trim());
  const named = terms.filter((term) => term !== "string" && term !== PAGE_NUMBER_TERM);
  return unionNames(named.join("|"), "IRunOptions's children");
}

function contentClasses(): Set<string> {
  const declared = [
    ...unionNames(captured(/export declare type ParagraphChild = ([^;]+);/, "ParagraphChild"), "ParagraphChild"),
    ...[...declarations.matchAll(/export declare class (\w+) extends FileChild\b/g)].map(([, name]) => name),
    ...runChildNames(),
    ...unionNames(captured(/export declare type MathComponent = ([^;]+);/, "MathComponent"), "MathComponent"),
  ];
  const aliases = exportAliases();
  const exported = declared.flatMap((name) => aliases.get(name) ?? [name]);
  return new Set(exported.filter((name) => name in docx));
}

const classes = contentClasses();
const kindOf = new Map(Object.entries(ELEMENTS).map(([kind, row]) => [row.docx, kind]));

describe("docx.js content classes", () => {
  test("are read from index.d.ts", () => {
    expect(classes.size).toBeGreaterThan(20);
    expect(classes).toContain("Paragraph");
    expect(classes).toContain("Math");
    expect(classes).not.toContain("Math_2");
  });

  test("each is a kind in ELEMENTS or listed in NOT_MAPPED", () => {
    expect([...classes].filter((name) => !kindOf.has(name) && !(name in NOT_MAPPED))).toEqual([]);
  });

  test("every NOT_MAPPED entry is still a content class", () => {
    expect(Object.keys(NOT_MAPPED).filter((name) => !classes.has(name))).toEqual([]);
  });

  test("every NOT_MAPPED entry gives a reason", () => {
    expect(Object.entries(NOT_MAPPED).filter(([, reason]) => reason.trim() === "")).toEqual([]);
  });
});
