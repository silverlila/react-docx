import * as docx from "docx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ELEMENTS, NOT_MAPPED } from "../src/schema/elements";

/** docx.js's own declarations. A docx.js upgrade that changes their shape fails here, which is the signal:
 *  map the new content, or record in NOT_MAPPED why not. Do not loosen the patterns. */
const declarations = readFileSync(join(createRequire(import.meta.url).resolve("docx"), "../index.d.ts"), "utf8");

function captured(pattern: RegExp, what: string): string {
  const match = declarations.match(pattern);
  if (match === null) throw new Error(`docx.js's index.d.ts no longer declares ${what} as ${pattern}`);
  return match[1];
}

/** The type names of a `A | B | C` union, every one of which must be a bare identifier. */
function unionNames(union: string, what: string): string[] {
  return union.split("|").map((term) => {
    const name = term.trim();
    if (!/^\w+$/.test(name)) throw new Error(`${what} has a term that is not a type name: ${name}`);
    return name;
  });
}

/** `export { Math_2 as Math }`: the declared name → the names it is exported as. */
function exportAliases(): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const [, declared, exported] of declarations.matchAll(/^export \{ (\w+) as (\w+) \}$/gm)) {
    aliases.set(declared, [...(aliases.get(declared) ?? []), exported]);
  }
  return aliases;
}

const PAGE_NUMBER_TERM = "(typeof PageNumber)[keyof typeof PageNumber]";

/** IRunOptions children, less the literal strings it also takes. */
function runChildNames(): string[] {
  const union = captured(
    /export declare type IRunOptions = \{\s*readonly children\?: readonly \(([^;]+)\)\[\];/,
    "IRunOptions's children"
  );
  const terms = union.split("|").map((term) => term.trim());
  const named = terms.filter((term) => term !== "string" && term !== PAGE_NUMBER_TERM);
  return unionNames(named.join("|"), "IRunOptions's children");
}

/** Every docx.js content class, by the name it is exported as at runtime. */
function contentClasses(): Set<string> {
  const declared = [
    ...unionNames(captured(/export declare type ParagraphChild = ([^;]+);/, "ParagraphChild"), "ParagraphChild"),
    ...[...declarations.matchAll(/export declare class (\w+) extends FileChild\b/g)].map(([, name]) => name),
    ...runChildNames(),
    ...unionNames(captured(/export declare type MathComponent = ([^;]+);/, "MathComponent"), "MathComponent"),
  ];
  const aliases = exportAliases();
  const exported = declared.flatMap((name) => aliases.get(name) ?? [name]);
  // Drops the classes docx.js declares but does not export: Begin, FieldInstruction, Separate, End, Break.
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
    const rows = [...classes].sort().map((name) => `${name} → ${kindOf.get(name) ?? NOT_MAPPED[name] ?? "(unmapped)"}`);
    console.info(rows.join("\n"));
    expect([...classes].filter((name) => !kindOf.has(name) && !(name in NOT_MAPPED))).toEqual([]);
  });

  test("every NOT_MAPPED entry is still a content class", () => {
    expect(Object.keys(NOT_MAPPED).filter((name) => !classes.has(name))).toEqual([]);
  });

  test("every NOT_MAPPED entry gives a reason", () => {
    expect(Object.entries(NOT_MAPPED).filter(([, reason]) => reason.trim() === "")).toEqual([]);
  });
});
