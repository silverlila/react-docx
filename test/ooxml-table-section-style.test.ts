import type * as docx from "docx";
import { describe, expect, test } from "vitest";
import type { CodecEnv } from "../src/ooxml/codec";
import { readLevel } from "../src/ooxml/level";
import { readSectionProperties } from "../src/ooxml/section";
import { readDocDefaults, readStyle } from "../src/ooxml/style";
import {
  readCellProperties,
  readRowProperties,
  readTableProperties,
  type CellOptions,
  type RowOptions,
  type TableOptions,
} from "../src/ooxml/table";
import { parseXml } from "../src/read/xml";
import {
  cellPropertiesXml,
  docDefaultsXml,
  levelXml,
  rowPropertiesXml,
  sectionPropertiesXml,
  styleXml,
  tablePropertiesXml,
  type StyleSample,
} from "./support/docx-props";

const NO_FONTS = { latin: null, eastAsia: null, complex: null };
const EMPTY_ENV: CodecEnv = { theme: { fonts: { major: NO_FONTS, minor: NO_FONTS }, colors: {} } };

const BORDER = { style: "single", size: 4, color: "auto" } as const;

const TABLE_SAMPLES: readonly TableOptions[] = [
  { style: "TableGrid" },
  { width: { size: 9000, type: "dxa" } },
  { width: { size: 100, type: "pct" } },
  { columnWidths: [3000, 6000] },
  { indent: { size: 720, type: "dxa" } },
  { layout: "fixed" },
  { borders: { top: { style: "double", size: 8, color: "FF0000" }, insideHorizontal: { style: "dotted", size: 2 } } },
  { alignment: "center" },
  { visuallyRightToLeft: true },
  { margins: { top: 100, bottom: 100, left: 120, right: 120 } },
  { margins: { left: 5, marginUnitType: "pct" } },
  { float: { horizontalAnchor: "margin", absoluteHorizontalPosition: 100 } },
  {
    float: {
      horizontalAnchor: "page",
      verticalAnchor: "text",
      relativeHorizontalPosition: "center",
      relativeVerticalPosition: "top",
      leftFromText: 180,
      rightFromText: 180,
      topFromText: 0,
      bottomFromText: 0,
      overlap: "never",
    },
  },
  { cellSpacing: { value: 50, type: "dxa" } },
];

const ROW_SAMPLES: readonly RowOptions[] = [
  { cantSplit: true },
  { cantSplit: false },
  { tableHeader: true },
  { height: { value: 400, rule: "exact" } },
  { height: { value: 300, rule: "atLeast" } },
  { cellSpacing: { value: 20 } },
];

const CELL_SAMPLES: readonly CellOptions[] = [
  { width: { size: 3000, type: "dxa" } },
  { columnSpan: 2 },
  { verticalMerge: "restart" },
  { verticalMerge: "continue" },
  { borders: { top: BORDER, start: BORDER, left: BORDER, bottom: BORDER, end: BORDER, right: BORDER } },
  { shading: { type: "clear", fill: "D9D9D9", color: "auto" } },
  { margins: { top: 50, left: 100, marginUnitType: "dxa" } },
  { verticalAlign: "center" },
  { textDirection: "btLr" },
];

const SECTION_SAMPLES: readonly docx.ISectionPropertiesOptions[] = [
  {
    page: {
      size: { width: 11906, height: 16838 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 },
    },
  },
  { page: { size: { width: 12240, height: 15840, orientation: "landscape" } } },
  { page: { pageNumbers: { start: 1, formatType: "upperRoman", separator: "hyphen" } } },
  {
    page: {
      borders: {
        pageBorders: { display: "allPages", offsetFrom: "page", zOrder: "front" },
        pageBorderTop: { style: "single", size: 6, color: "auto", space: 24 },
        pageBorderBottom: { style: "single", size: 6, color: "auto", space: 24 },
      },
    },
  },
  { page: { textDirection: "tbRl" } },
  { grid: { linePitch: 312, charSpace: 100, type: "lines" } },
  { lineNumbers: { countBy: 5, start: 1, restart: "newPage", distance: 360 } },
  { titlePage: true },
  { verticalAlign: "center" },
  { column: { count: 2, space: 708 } },
  { column: { count: 3, space: 720, separate: true, equalWidth: true } },
  { type: "continuous" },
];

const LEVEL_SAMPLES: readonly docx.ILevelsOptions[] = [
  {
    level: 0,
    format: "decimal",
    text: "%1.",
    alignment: "left",
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  },
  { level: 1, start: 3, format: "lowerLetter", text: "%2)", suffix: "space", isLegalNumberingStyle: true },
  { level: 2, format: "bullet", text: "▪", alignment: "left", style: { run: { font: "Wingdings" } } },
];

const STYLE_SAMPLES: readonly StyleSample[] = [
  {
    kind: "paragraph",
    options: {
      id: "Quote",
      name: "Quote",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      paragraph: { spacing: { before: 200, after: 160 }, indent: { left: 864, right: 864 }, alignment: "center" },
      run: { italics: true, color: "404040" },
    },
  },
  { kind: "paragraph", options: { id: "Hidden", name: "Hidden", semiHidden: true, uiPriority: 1, link: "HiddenChar" } },
  {
    kind: "character",
    options: { id: "Strong", name: "Strong", uiPriority: 22, unhideWhenUsed: true, run: { bold: true } },
  },
];

const DOC_DEFAULTS_SAMPLES: readonly docx.IDocumentDefaultsOptions[] = [
  { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" } } },
  { run: { size: 24 } },
];

const named = <T>(samples: readonly T[]) => samples.map((sample) => [JSON.stringify(sample), sample] as const);

const droppedIn = (notes: readonly { fate: string }[]) => notes.filter((note) => note.fate === "dropped");

describe("the codecs invert what docx.js writes", () => {
  test.each(named(TABLE_SAMPLES))("table %s", async (_name, sample) => {
    const x1 = await tablePropertiesXml(sample);
    const read = readTableProperties(parseXml(`<w:tbl>${x1}</w:tbl>`), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await tablePropertiesXml(read.options)).toBe(x1);
  });

  test.each(named(ROW_SAMPLES))("row %s", async (_name, sample) => {
    const x1 = await rowPropertiesXml(sample);
    expect(x1).not.toBe("");
    const read = readRowProperties(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await rowPropertiesXml(read.options)).toBe(x1);
  });

  test.each(named(CELL_SAMPLES))("cell %s", async (_name, sample) => {
    const x1 = await cellPropertiesXml(sample);
    expect(x1).not.toBe("");
    const read = readCellProperties(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await cellPropertiesXml(read.options)).toBe(x1);
  });

  test.each(named(SECTION_SAMPLES))("section %s", async (_name, sample) => {
    const x1 = await sectionPropertiesXml(sample);
    const read = readSectionProperties(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await sectionPropertiesXml(read.options.properties ?? {})).toBe(x1);
  });

  test.each(named(LEVEL_SAMPLES))("level %s", async (_name, sample) => {
    const x1 = await levelXml(sample);
    expect(x1).not.toBe("");
    const read = readLevel(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await levelXml(read.options)).toBe(x1);
  });

  test.each(named(STYLE_SAMPLES))("style %s", async (_name, sample) => {
    const x1 = await styleXml(sample);
    expect(x1).not.toBe("");
    const read = readStyle(parseXml(x1), EMPTY_ENV);
    if (read.kind !== "paragraph" && read.kind !== "character") throw new Error(`read as ${read.kind}`);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await styleXml(read)).toBe(x1);
  });

  test.each(named(DOC_DEFAULTS_SAMPLES))("document defaults %s", async (_name, sample) => {
    const x1 = await docDefaultsXml(sample);
    const read = readDocDefaults(parseXml(x1), EMPTY_ENV);
    expect(droppedIn(read.notes)).toEqual([]);
    expect(await docDefaultsXml(read.options)).toBe(x1);
  });
});

describe("readTableProperties", () => {
  test("reads the column widths from w:tblGrid, beside w:tblPr", () => {
    const read = readTableProperties(
      parseXml(
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="5760"/></w:tblGrid></w:tbl>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({ style: "TableGrid", columnWidths: [2880, 5760] });
    expect(read.notes).toEqual([]);
  });

  test("drops w:tblLook, which docx.js has no option for", () => {
    const read = readTableProperties(
      parseXml(
        '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr></w:tbl>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({ width: { size: 0, type: "auto" } });
    expect(read.notes).toEqual([{ fate: "dropped", element: "w:tblLook", detail: expect.any(String) }]);
  });

  test("reads Word's pct width, in fiftieths of a percent, as a percentage", () => {
    const read = readTableProperties(
      parseXml('<w:tbl><w:tblPr><w:tblW w:w="2500" w:type="pct"/></w:tblPr></w:tbl>'),
      EMPTY_ENV
    );
    expect(read.options).toEqual({ width: { size: "50%", type: "pct" } });
  });

  test("reads Word's w:tblOverlap beside w:tblpPr into the float", () => {
    const read = readTableProperties(
      parseXml(
        '<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="page" w:tblpX="500"/><w:tblOverlap w:val="never"/></w:tblPr></w:tbl>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({
      float: { horizontalAnchor: "page", absoluteHorizontalPosition: 500, overlap: "never" },
    });
    expect(read.notes).toEqual([]);
  });
});

describe("readCellProperties", () => {
  test("reads a w:vMerge with no w:val as a continuation", () => {
    const read = readCellProperties(
      parseXml('<w:tcPr><w:tcW w:w="2880" w:type="dxa"/><w:vMerge/></w:tcPr>'),
      EMPTY_ENV
    );
    expect(read.options).toEqual({ width: { size: 2880, type: "dxa" }, verticalMerge: "continue" });
    expect(read.notes).toEqual([]);
  });

  test("ignores w:cnfStyle as editing noise", () => {
    const read = readCellProperties(parseXml('<w:tcPr><w:cnfStyle w:val="001000000000"/></w:tcPr>'), EMPTY_ENV);
    expect(read.options).toEqual({});
    expect(read.notes.map((note) => note.fate)).toEqual(["ignored"]);
  });
});

describe("readSectionProperties", () => {
  const SECT_PR = [
    '<w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<w:headerReference w:type="default" r:id="rId8"/>',
    '<w:headerReference w:type="first" r:id="rId9"/>',
    '<w:footerReference w:type="default" r:id="rId10"/>',
    '<w:pgSz w:w="12240" w:h="15840"/>',
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>',
    '<w:cols w:space="720"/>',
    "<w:titlePg/>",
    '<w:docGrid w:linePitch="360"/>',
    "</w:sectPr>",
  ].join("");

  test("returns the header and footer references beside the options", () => {
    const read = readSectionProperties(parseXml(SECT_PR), EMPTY_ENV);
    expect(read.references).toEqual([
      { kind: "header", type: "default", relId: "rId8" },
      { kind: "header", type: "first", relId: "rId9" },
      { kind: "footer", type: "default", relId: "rId10" },
    ]);
    expect(read.options).toEqual({
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720, gutter: 0 },
        },
        column: { space: 720 },
        titlePage: true,
        grid: { linePitch: 360 },
      },
    });
    expect(read.notes).toEqual([]);
  });

  test("reads a landscape page size as docx.js's portrait width and height", () => {
    const read = readSectionProperties(
      parseXml('<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>'),
      EMPTY_ENV
    );
    expect(read.options).toEqual({
      properties: { page: { size: { width: 11906, height: 16838, orientation: "landscape" } } },
    });
  });

  test("drops w:printerSettings, which points at a part docx.js cannot write", () => {
    const read = readSectionProperties(parseXml('<w:sectPr><w:printerSettings r:id="rId3"/></w:sectPr>'), EMPTY_ENV);
    expect(read.options).toEqual({});
    expect(read.notes).toEqual([{ fate: "dropped", element: "w:printerSettings", detail: expect.any(String) }]);
  });

  test("drops each w:col, because docx.js needs Column instances for them", () => {
    const read = readSectionProperties(
      parseXml(
        '<w:sectPr><w:cols w:num="2" w:equalWidth="0"><w:col w:w="3000" w:space="720"/><w:col w:w="5000"/></w:cols></w:sectPr>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({ properties: { column: { count: 2, equalWidth: false } } });
    expect(read.notes.map((note) => [note.fate, note.element])).toEqual([
      ["dropped", "w:col"],
      ["dropped", "w:col"],
    ]);
  });
});

describe("readLevel", () => {
  test("reads a Word bullet level, ignoring the tentative attribute", () => {
    const read = readLevel(
      parseXml(
        '<w:lvl w:ilvl="1" w:tplc="04090003" w:tentative="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New" w:hint="default"/></w:rPr></w:lvl>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({
      level: 1,
      start: 1,
      format: "bullet",
      text: "o",
      alignment: "left",
      style: {
        paragraph: { indent: { left: 1440, hanging: 360 } },
        run: { font: { ascii: "Courier New", hAnsi: "Courier New", cs: "Courier New", hint: "default" } },
      },
    });
    expect(read.notes).toEqual([]);
  });
});

describe("readStyle", () => {
  test("keeps Word's default Normal style raw, as its serialized input", () => {
    const xml =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>';
    expect(readStyle(parseXml(xml), EMPTY_ENV)).toEqual({ kind: "raw", xml, because: "default" });
  });

  test("keeps a character style marked default raw", () => {
    const xml =
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>';
    expect(readStyle(parseXml(xml), EMPTY_ENV)).toEqual({ kind: "raw", xml, because: "default" });
  });

  test("keeps the Table Grid table style raw", () => {
    const xml =
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>';
    expect(readStyle(parseXml(xml), EMPTY_ENV)).toEqual({ kind: "raw", xml, because: "table" });
  });

  test("drops a raw style that carries an r: reference", () => {
    const read = readStyle(
      parseXml(
        '<w:style w:type="numbering" w:styleId="Bullets"><w:name w:val="Bullets"/><w:pPr><w:numPr><w:numId r:id="rId1"/></w:numPr></w:pPr></w:style>'
      ),
      EMPTY_ENV
    );
    expect(read).toEqual({ kind: "dropped", because: expect.stringContaining("r:") });
  });

  test("drops a raw style whose text stands beside child elements, which docx.js cannot write", () => {
    const read = readStyle(
      parseXml('<w:style w:type="table" w:styleId="T">text<w:name w:val="T"/></w:style>'),
      EMPTY_ENV
    );
    expect(read).toEqual({ kind: "dropped", because: expect.stringContaining("mixes text") });
  });

  test("returns a paragraph style's w:numPr beside its options", () => {
    const read = readStyle(
      parseXml(
        '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr><w:ind w:left="360"/></w:pPr></w:style>'
      ),
      EMPTY_ENV
    );
    expect(read).toEqual({
      kind: "paragraph",
      options: { id: "ListBullet", name: "List Bullet", basedOn: "Normal", paragraph: { indent: { left: 360 } } },
      numPr: { numId: "4", level: 0 },
      notes: [],
    });
  });
});

describe("readDocDefaults", () => {
  test("reads Word's document defaults into run and paragraph", () => {
    const read = readDocDefaults(
      parseXml(
        '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      ),
      EMPTY_ENV
    );
    expect(read.options).toEqual({
      run: { size: 22, language: { value: "en-US" } },
      paragraph: { spacing: { after: 160, line: 259, lineRule: "auto" } },
    });
    expect(read.notes).toEqual([]);
  });
});
