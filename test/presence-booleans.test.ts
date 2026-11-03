import * as docx from "docx";
import { describe, expect, test } from "vitest";
import { DEFAULT_STYLE_SLOTS, PAGE_NUMBER_VALUES, PRESENCE_ONLY } from "../src/schema/docx-facts";
import { docxXml } from "./support/docx-xml";

type ProbedKind = "Paragraph" | "TextRun" | "Table" | "TableRow" | "TableCell" | "Section";

const BOOLEAN_OPTIONS: readonly { readonly kind: ProbedKind; readonly path: string }[] = [
  ...[
    "bidirectional",
    "pageBreakBefore",
    "widowControl",
    "suppressLineNumbers",
    "wordWrap",
    "overflowPunctuation",
    "autoSpaceEastAsianText",
    "thematicBreak",
    "contextualSpacing",
    "keepNext",
    "keepLines",
  ].map((path) => ({ kind: "Paragraph" as const, path })),
  ...[
    "noProof",
    "bold",
    "boldComplexScript",
    "italics",
    "italicsComplexScript",
    "sizeComplexScript",
    "rightToLeft",
    "smallCaps",
    "allCaps",
    "strike",
    "doubleStrike",
    "subScript",
    "superScript",
    "highlightComplexScript",
    "emboss",
    "imprint",
    "snapToGrid",
    "vanish",
    "specVanish",
    "math",
  ].map((path) => ({ kind: "TextRun" as const, path })),
  { kind: "Table", path: "visuallyRightToLeft" },
  { kind: "TableRow", path: "cantSplit" },
  { kind: "TableRow", path: "tableHeader" },
  { kind: "Section", path: "properties.titlePage" },
];

function optionAt(path: string, value: boolean | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  const [head, ...rest] = path.split(".");
  return { [head]: rest.length === 0 ? value : optionAt(rest.join("."), value) };
}

function probeDocument(kind: ProbedKind, option: Record<string, unknown>): docx.Document {
  const cell = (cellOption: Record<string, unknown> = {}) =>
    new docx.TableCell({ ...cellOption, children: [new docx.Paragraph("x")] });
  const row = (rowOption: Record<string, unknown> = {}) => new docx.TableRow({ ...rowOption, children: [cell()] });
  const blocks: Record<ProbedKind, () => docx.FileChild[]> = {
    Paragraph: () => [new docx.Paragraph({ ...option, children: [new docx.TextRun("x")] })],
    TextRun: () => [new docx.Paragraph({ children: [new docx.TextRun({ ...option, text: "x" })] })],
    Table: () => [new docx.Table({ ...option, rows: [row()] })],
    TableRow: () => [new docx.Table({ rows: [row(option)] })],
    TableCell: () => [new docx.Table({ rows: [new docx.TableRow({ children: [cell(option)] })] })],
    Section: () => [new docx.Paragraph("x")],
  };
  const section = kind === "Section" ? option : {};
  return new docx.Document({ sections: [{ ...section, children: blocks[kind]() }] });
}

async function documentXml(kind: ProbedKind, path: string, value: boolean | undefined): Promise<string> {
  const buffer = await docx.Packer.toBuffer(probeDocument(kind, optionAt(path, value)));
  return docxXml(buffer)["word/document.xml"];
}

async function probePresenceOnly(): Promise<Record<string, string[]>> {
  const found: Record<string, string[]> = {};
  for (const { kind, path } of BOOLEAN_OPTIONS) {
    const absent = await documentXml(kind, path, undefined);
    const yes = await documentXml(kind, path, true);
    const no = await documentXml(kind, path, false);
    if (no === yes && no !== absent) (found[kind] ??= []).push(path);
  }
  return found;
}

describe("docx.js presence-only booleans", () => {
  test("PRESENCE_ONLY lists exactly the boolean options docx.js writes the same for true and false", async () => {
    const probed = await probePresenceOnly();
    expect(probed).toEqual(PRESENCE_ONLY);
  });

  test("the probe reaches the option, including a nested section property", async () => {
    expect(await documentXml("TableRow", "tableHeader", undefined)).not.toContain("w:tblHeader");
    expect(await documentXml("TableRow", "tableHeader", true)).toContain("<w:tblHeader/>");
    expect(await documentXml("TableRow", "tableHeader", false)).toContain('<w:tblHeader w:val="false"/>');
    expect(await documentXml("Section", "properties.titlePage", true)).toContain("<w:titlePg/>");
    expect(await documentXml("Section", "properties.titlePage", false)).toContain('<w:titlePg w:val="false"/>');
  });
});

describe("docx.js facts canonicalize relies on", () => {
  test("PAGE_NUMBER_VALUES are the values of docx.PageNumber", () => {
    expect([...PAGE_NUMBER_VALUES].sort()).toEqual(Object.values(docx.PageNumber).sort());
  });

  test.each(Object.entries(DEFAULT_STYLE_SLOTS))(
    "styles.default.%s replaces docx.js's built-in style of that id and kind",
    async (id, { key, kind }) => {
      const doc = new docx.Document({
        styles: { default: { [key]: { run: { color: "ABCDEF" } } } },
        sections: [{ children: [] }],
      });
      const styles = docxXml(await docx.Packer.toBuffer(doc))["word/styles.xml"];
      const definitions = styles.split("<w:style ").filter((s) => s.includes(`w:styleId="${id}"`));
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toContain(`w:type="${kind}"`);
      expect(definitions[0]).toContain('w:val="ABCDEF"');
    }
  );
});
