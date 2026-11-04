import { describe, expect, test } from "vitest";
import type { CodecEnv } from "../src/ooxml/codec";
import { readParagraphProperties, type ParagraphOptions } from "../src/ooxml/paragraph";
import { readRunProperties, type RunOptions } from "../src/ooxml/run";
import { parseXml } from "../src/ooxml/xml";
import { paragraphPropertiesXml, runPropertiesXml } from "./support/docx-props";

const NO_FONTS = { latin: null, eastAsia: null, complex: null };
const EMPTY_ENV: CodecEnv = { theme: { fonts: { major: NO_FONTS, minor: NO_FONTS }, colors: {} } };
const THEMED_ENV: CodecEnv = {
  theme: {
    fonts: { major: NO_FONTS, minor: { latin: "Calibri", eastAsia: "MS Mincho", complex: "Arial" } },
    colors: { accent1: "4472C4" },
  },
};

const RUN_SAMPLES: readonly RunOptions[] = [
  { style: "Emphasis" },
  { bold: true },
  { bold: false },
  { boldComplexScript: true },
  { italics: true },
  { italics: false, italicsComplexScript: true },
  { allCaps: true },
  { smallCaps: true },
  { strike: true },
  { doubleStrike: true },
  { emboss: true },
  { imprint: true },
  { noProof: true },
  { snapToGrid: false },
  { vanish: true },
  { specVanish: true },
  { rightToLeft: true },
  { math: true },
  { size: 28 },
  { size: 28, sizeComplexScript: 20 },
  { color: "FF0000" },
  { color: "auto" },
  { underline: { type: "double", color: "00FF00" } },
  { highlight: "yellow" },
  { highlight: "yellow", highlightComplexScript: "red" },
  { shading: { type: "clear", fill: "EEEEEE", color: "auto" } },
  { font: "Arial" },
  { font: { ascii: "A", eastAsia: "B", cs: "C", hAnsi: "A" } },
  { font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Arial", cs: "Arial", hint: "eastAsia" } },
  { characterSpacing: 40 },
  { scale: 90 },
  { kern: 28 },
  { position: "6pt" },
  { superScript: true },
  { subScript: true },
  { effect: "shimmer" },
  { emphasisMark: { type: "dot" } },
  { language: { value: "en-US", eastAsia: "ja-JP" } },
  { language: { bidirectional: "ar-SA" } },
  { border: { style: "single", size: 4, color: "FF0000", space: 1 } },
  { revision: { id: 1, author: "Ann", date: "2026-01-01T00:00:00Z", bold: true, size: 20 } },
];

const PARAGRAPH_SAMPLES: readonly ParagraphOptions[] = [
  { style: "Heading1" },
  { keepNext: true },
  { keepLines: true },
  { pageBreakBefore: true },
  { widowControl: false },
  { suppressLineNumbers: true },
  { contextualSpacing: true },
  { bidirectional: true },
  { wordWrap: true },
  { overflowPunctuation: true },
  { autoSpaceEastAsianText: false },
  { alignment: "both" },
  { alignment: "center" },
  { spacing: { before: 120, after: 240, line: 276, lineRule: "auto" } },
  { spacing: { after: 0, beforeAutoSpacing: true, afterAutoSpacing: true } },
  { indent: { left: 720, hanging: 360 } },
  { indent: { right: 360, firstLine: 720 } },
  { tabStops: [{ type: "right", position: 9026, leader: "dot" }] },
  {
    tabStops: [
      { type: "left", position: 720 },
      { type: "clear", position: 1440 },
    ],
  },
  { border: { bottom: { style: "single", size: 6, color: "auto", space: 1 } } },
  {
    border: {
      top: { style: "double", size: 4, color: "FF0000" },
      left: { style: "dotted" },
      right: { style: "dashed" },
    },
  },
  { shading: { type: "solid", fill: "FFFF00", color: "000000" } },
  { outlineLevel: 1 },
  {
    frame: {
      type: "absolute",
      position: { x: 1000, y: 2000 },
      width: 4000,
      height: 1000,
      anchor: { horizontal: "margin", vertical: "margin" },
    },
  },
  {
    frame: {
      type: "alignment",
      alignment: { x: "center", y: "top" },
      width: 4000,
      height: 1000,
      anchor: { horizontal: "page", vertical: "page" },
      wrap: "around",
      space: { horizontal: 100, vertical: 200 },
      dropCap: "drop",
      lines: 3,
      rule: "exact",
      anchorLock: true,
    },
  },
  { run: { bold: true } },
];

const named = <T>(samples: readonly T[]) => samples.map((sample) => [JSON.stringify(sample), sample] as const);

const droppedIn = (notes: readonly { fate: string }[]) => notes.filter((note) => note.fate === "dropped");

describe("the codecs invert what docx.js writes", () => {
  test.each(named(RUN_SAMPLES))("run %s", async (_name, sample) => {
    const x1 = await runPropertiesXml(sample);
    expect(x1).not.toBe("");
    const read = readRunProperties(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await runPropertiesXml(read.options)).toBe(x1);
  });

  test.each(named(PARAGRAPH_SAMPLES))("paragraph %s", async (_name, sample) => {
    const x1 = await paragraphPropertiesXml(sample);
    expect(x1).not.toBe("");
    const read = readParagraphProperties(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await paragraphPropertiesXml(read.options)).toBe(x1);
  });
});

describe("readRunProperties", () => {
  test("keeps what docx.js can write and drops a w14 property with a note", () => {
    const read = readRunProperties(
      parseXml('<w:rPr><w:b/><w:color w:val="FF0000"/><w:sz w:val="28"/><w14:ligatures w14:val="all"/></w:rPr>'),
      EMPTY_ENV,
    );
    expect(read.options).toEqual({ bold: true, color: "FF0000", size: 28 });
    expect(read.notes).toEqual([{ fate: "dropped", element: "w14:ligatures", detail: expect.any(String) }]);
  });

  test("resolves theme fonts to the theme's typefaces, one note per attribute", () => {
    const read = readRunProperties(
      parseXml(
        '<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:cstheme="minorBidi"/></w:rPr>',
      ),
      THEMED_ENV,
    );
    expect(read.options).toEqual({ font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "MS Mincho", cs: "Arial" } });
    expect(read.notes.map((note) => note.fate)).toEqual(["resolved", "resolved", "resolved", "resolved"]);
  });

  test("takes the hex Word wrote beside a theme colour, with no note", () => {
    const read = readRunProperties(
      parseXml('<w:rPr><w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="80"/></w:rPr>'),
      THEMED_ENV,
    );
    expect(read.options).toEqual({ color: "1F3864" });
    expect(read.notes).toEqual([]);
  });

  test("resolves a theme colour with no hex from the file's theme", () => {
    const read = readRunProperties(parseXml('<w:rPr><w:color w:themeColor="accent1"/></w:rPr>'), THEMED_ENV);
    expect(read.options).toEqual({ color: "4472C4" });
    expect(read.notes).toEqual([{ fate: "resolved", element: "w:color", detail: expect.stringContaining("accent1") }]);
  });

  test("applies a theme tint: 4472C4 tinted 99 is 8FAADC", () => {
    const read = readRunProperties(
      parseXml('<w:rPr><w:color w:val="auto" w:themeColor="accent1" w:themeTint="99"/></w:rPr>'),
      THEMED_ENV,
    );
    expect(read.options).toEqual({ color: "8FAADC" });
  });

  test("keeps a complex-script twin that is off while its main is on as false, with a note", () => {
    const read = readRunProperties(parseXml('<w:rPr><w:b/><w:bCs w:val="0"/></w:rPr>'), EMPTY_ENV);
    expect(read.options).toEqual({ bold: true, boldComplexScript: false });
    expect(read.notes).toEqual([{ fate: "dropped", element: "w:bCs", detail: expect.any(String) }]);
  });

  test("turns Word's half-point position into points", () => {
    const read = readRunProperties(parseXml('<w:rPr><w:position w:val="-5"/></w:rPr>'), EMPTY_ENV);
    expect(read.options).toEqual({ position: "-2.5pt" });
  });
});

describe("readParagraphProperties", () => {
  test("maps an explicit off to false while docx.js can write it", () => {
    const read = readParagraphProperties(parseXml('<w:pPr><w:keepNext w:val="0"/></w:pPr>'), EMPTY_ENV);
    expect(read.options).toEqual({ keepNext: false });
    expect(read.notes).toEqual([]);
  });

  test("drops a child it has no fate for, naming the element", () => {
    const read = readParagraphProperties(parseXml('<w:pPr><w:foo/><w:jc w:val="center"/></w:pPr>'), EMPTY_ENV);
    expect(read.options).toEqual({ alignment: "center" });
    expect(read.notes).toEqual([{ fate: "dropped", element: "w:foo", detail: expect.any(String) }]);
  });

  test("returns w:numPr and w:sectPr beside the options, not in them", () => {
    const read = readParagraphProperties(
      parseXml(
        '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>',
      ),
      EMPTY_ENV,
    );
    expect(read.options).toEqual({ style: "ListParagraph" });
    expect(read.numPr).toEqual({ numId: "3", level: 1 });
    expect(read.sectPr?.name).toBe("w:sectPr");
    expect(read.notes).toEqual([]);
  });
});
