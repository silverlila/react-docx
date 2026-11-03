/** The property elements docx.js writes for given options, for the writer-inverse tests.
 *
 *  - Each builds a minimal document with docx.Packer, reads the part with the reader's own parseXml, and
 *    serializes the first matching element. Parsing, not a regex, because a w:rPr can hold a w:rPrChange
 *    with a w:rPr of its own.
 *  - docx.js writes its own default-bullet-numbering abstractNum first, so a configured level is in the
 *    last w:abstractNum. */

import * as docx from "docx";
import { strFromU8, unzipSync } from "fflate";
import type { ParagraphOptions } from "../../src/ooxml/paragraph";
import type { RunOptions } from "../../src/ooxml/run";
import type { CellOptions, RowOptions, TableOptions } from "../../src/ooxml/table";
import { childNamed, childrenNamed, parseXml, serializeXml, type XmlElement } from "../../src/read/xml";

export type StyleSample =
  | { readonly kind: "paragraph"; readonly options: docx.IParagraphStyleOptions }
  | { readonly kind: "character"; readonly options: docx.ICharacterStyleOptions };

async function partOf(document: docx.Document, part: string): Promise<XmlElement> {
  const files = unzipSync(new Uint8Array(await docx.Packer.toBuffer(document)));
  return parseXml(strFromU8(files[part]));
}

async function bodyOf(document: docx.Document): Promise<XmlElement | null> {
  return childNamed(await partOf(document, "word/document.xml"), "w:body");
}

const oneSection = (children: docx.FileChild[]) => new docx.Document({ sections: [{ children }] });

async function firstParagraph(paragraph: docx.Paragraph): Promise<XmlElement | null> {
  return childNamed(await bodyOf(oneSection([paragraph])), "w:p");
}

const oneCell = (options: CellOptions = {}) => new docx.TableCell({ ...options, children: [new docx.Paragraph("x")] });

async function firstTable(table: docx.Table): Promise<XmlElement | null> {
  return childNamed(await bodyOf(oneSection([table])), "w:tbl");
}

const firstRow = (table: XmlElement | null) => childNamed(table, "w:tr");

const xmlOf = (el: XmlElement | null): string => (el === null ? "" : serializeXml(el));

/** The <w:rPr> docx.js writes for a TextRun with these options, or "" when it writes none. */
export async function runPropertiesXml(options: RunOptions): Promise<string> {
  const paragraph = await firstParagraph(new docx.Paragraph({ children: [new docx.TextRun({ ...options, text: "x" })] }));
  return xmlOf(childNamed(childNamed(paragraph, "w:r"), "w:rPr"));
}

/** The <w:pPr> docx.js writes for a Paragraph with these options (and one "x" run), or "". */
export async function paragraphPropertiesXml(options: ParagraphOptions): Promise<string> {
  const paragraph = await firstParagraph(new docx.Paragraph({ ...options, children: [new docx.TextRun("x")] }));
  return xmlOf(childNamed(paragraph, "w:pPr"));
}

/** The <w:tblPr> and <w:tblGrid> docx.js writes for a one-cell Table with these options. */
export async function tablePropertiesXml(options: TableOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ ...options, rows: [new docx.TableRow({ children: [oneCell()] })] }));
  return xmlOf(childNamed(table, "w:tblPr")) + xmlOf(childNamed(table, "w:tblGrid"));
}

/** The <w:trPr> docx.js writes for a one-cell TableRow with these options, or "". */
export async function rowPropertiesXml(options: RowOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ rows: [new docx.TableRow({ ...options, children: [oneCell()] })] }));
  return xmlOf(childNamed(firstRow(table), "w:trPr"));
}

/** The <w:tcPr> docx.js writes for a TableCell with these options, or "". */
export async function cellPropertiesXml(options: CellOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ rows: [new docx.TableRow({ children: [oneCell(options)] })] }));
  return xmlOf(childNamed(childNamed(firstRow(table), "w:tc"), "w:tcPr"));
}

/** The body's last <w:sectPr> docx.js writes for a one-paragraph section with these properties. */
export async function sectionPropertiesXml(properties: docx.ISectionPropertiesOptions): Promise<string> {
  const document = new docx.Document({ sections: [{ properties, children: [new docx.Paragraph("x")] }] });
  return xmlOf(childrenNamed(await bodyOf(document), "w:sectPr").at(-1) ?? null);
}

/** The <w:lvl> docx.js writes for a numbering config holding only this level. */
export async function levelXml(level: docx.ILevelsOptions): Promise<string> {
  const document = new docx.Document({
    numbering: { config: [{ reference: "probe", levels: [level] }] },
    sections: [{ children: [] }],
  });
  const abstractNum = childrenNamed(await partOf(document, "word/numbering.xml"), "w:abstractNum").at(-1) ?? null;
  return xmlOf(childNamed(abstractNum, "w:lvl"));
}

/** The <w:style> docx.js writes for this paragraph or character style, found by its w:styleId. */
export async function styleXml(style: StyleSample): Promise<string> {
  const styles =
    style.kind === "paragraph" ? { paragraphStyles: [style.options] } : { characterStyles: [style.options] };
  const document = new docx.Document({ styles, sections: [{ children: [] }] });
  const written = childrenNamed(await partOf(document, "word/styles.xml"), "w:style");
  return xmlOf(written.find((el) => el.attributes["w:styleId"] === style.options.id) ?? null);
}

/** The <w:docDefaults> docx.js writes for these document defaults. */
export async function docDefaultsXml(document: docx.IDocumentDefaultsOptions): Promise<string> {
  const written = new docx.Document({ styles: { default: { document } }, sections: [{ children: [] }] });
  return xmlOf(childNamed(await partOf(written, "word/styles.xml"), "w:docDefaults"));
}
