import { describe, expect, test } from "vitest";
import { ELEMENTS, type Content } from "../src/schema/elements";

const MARKERS: { readonly [C in Content]: { readonly holds: readonly string[]; readonly lacks: readonly string[] } } = {
  block: { holds: ["Paragraph", "RawXml"], lacks: ["TextRun", "MathRun", "Tab"] },
  wrapped: { holds: ["Paragraph"], lacks: ["TextRun", "MathRun", "Tab", "RawXml"] },
  inline: { holds: ["TextRun", "RawXml"], lacks: ["Paragraph", "MathRun", "Tab"] },
  run: { holds: ["Tab", "RawXml"], lacks: ["Paragraph", "TextRun", "MathRun"] },
  math: { holds: ["MathRun"], lacks: ["Paragraph", "TextRun", "Tab", "RawXml"] },
  literal: { holds: [], lacks: ["Paragraph", "TextRun", "MathRun", "Tab", "RawXml"] },
  plain: { holds: [], lacks: ["Paragraph", "TextRun", "MathRun", "Tab", "RawXml"] },
};

describe("each kind's content model", () => {
  test.each(Object.entries(ELEMENTS))("%s's agrees with its children", (_kind, { content, children }) => {
    const legal: readonly string[] = children;
    const { holds, lacks } = MARKERS[content];
    expect(holds.filter((child) => !legal.includes(child))).toEqual([]);
    expect(lacks.filter((child) => legal.includes(child))).toEqual([]);
  });

  test("literal and plain hold the same children, so the kinds taking literal text are named: MathRun only", () => {
    const literal = Object.entries(ELEMENTS).filter(([, row]) => row.content === "literal");
    expect(literal.map(([kind]) => kind)).toEqual(["MathRun"]);
  });
});
