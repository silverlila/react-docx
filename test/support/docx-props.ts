/** The property elements docx.js writes for given options, for the writer-inverse tests.
 *
 *  - A w:rPr can hold a w:rPrChange with a w:rPr of its own, so the part is parsed rather than matched
 *    with a regex.
 *  - docx.js writes its own default-bullet-numbering abstractNum first, so a configured level is in the
 *    last w:abstractNum. */

import * as docx from "docx";
import { strFromU8, unzipSync } from "fflate";
import type { ParagraphOptions } from "../../src/ooxml/paragraph";
import type { RunOptions } from "../../src/ooxml/run";
import type { CellOptions, RowOptions, TableOptions } from "../../src/ooxml/table";
import { childNamed, childrenNamed, parseXml, serializeXml, type XmlElement } from "../../src/ooxml/xml";

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

export async function runPropertiesXml(options: RunOptions): Promise<string> {
  const paragraph = await firstParagraph(new docx.Paragraph({ children: [new docx.TextRun({ ...options, text: "x" })] }));
  return xmlOf(childNamed(childNamed(paragraph, "w:r"), "w:rPr"));
}

export async function imageRunXml(options: docx.IImageOptions): Promise<string> {
  const paragraph = await firstParagraph(new docx.Paragraph({ children: [new docx.ImageRun(options)] }));
  return xmlOf(childNamed(childNamed(paragraph, "w:r"), "w:drawing"));
}

export async function paragraphPropertiesXml(options: ParagraphOptions): Promise<string> {
  const paragraph = await firstParagraph(new docx.Paragraph({ ...options, children: [new docx.TextRun("x")] }));
  return xmlOf(childNamed(paragraph, "w:pPr"));
}

export async function tablePropertiesXml(options: TableOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ ...options, rows: [new docx.TableRow({ children: [oneCell()] })] }));
  return xmlOf(childNamed(table, "w:tblPr")) + xmlOf(childNamed(table, "w:tblGrid"));
}

export async function rowPropertiesXml(options: RowOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ rows: [new docx.TableRow({ ...options, children: [oneCell()] })] }));
  return xmlOf(childNamed(firstRow(table), "w:trPr"));
}

export async function cellPropertiesXml(options: CellOptions): Promise<string> {
  const table = await firstTable(new docx.Table({ rows: [new docx.TableRow({ children: [oneCell(options)] })] }));
  return xmlOf(childNamed(childNamed(firstRow(table), "w:tc"), "w:tcPr"));
}

export async function sectionPropertiesXml(properties: docx.ISectionPropertiesOptions): Promise<string> {
  const document = new docx.Document({ sections: [{ properties, children: [new docx.Paragraph("x")] }] });
  return xmlOf(childrenNamed(await bodyOf(document), "w:sectPr").at(-1) ?? null);
}

export async function levelXml(level: docx.ILevelsOptions): Promise<string> {
  const document = new docx.Document({
    numbering: { config: [{ reference: "probe", levels: [level] }] },
    sections: [{ children: [] }],
  });
  const abstractNum = childrenNamed(await partOf(document, "word/numbering.xml"), "w:abstractNum").at(-1) ?? null;
  return xmlOf(childNamed(abstractNum, "w:lvl"));
}

export async function styleXml(style: StyleSample): Promise<string> {
  const styles =
    style.kind === "paragraph" ? { paragraphStyles: [style.options] } : { characterStyles: [style.options] };
  const document = new docx.Document({ styles, sections: [{ children: [] }] });
  const written = childrenNamed(await partOf(document, "word/styles.xml"), "w:style");
  return xmlOf(written.find((el) => el.attributes["w:styleId"] === style.options.id) ?? null);
}

export async function docDefaultsXml(document: docx.IDocumentDefaultsOptions): Promise<string> {
  const written = new docx.Document({ styles: { default: { document } }, sections: [{ children: [] }] });
  return xmlOf(childNamed(await partOf(written, "word/styles.xml"), "w:docDefaults"));
}
