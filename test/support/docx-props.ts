/** The run and paragraph property elements docx.js writes for given options, for the writer-inverse tests.
 *
 *  - Each builds a one-paragraph document with docx.Packer and reads word/document.xml with the reader's
 *    own parseXml, then serializes the first paragraph's w:pPr, or its first run's w:rPr. Parsing, not a
 *    regex, because a w:rPr can hold a w:rPrChange with a w:rPr of its own. */

import * as docx from "docx";
import { strFromU8, unzipSync } from "fflate";
import type { ParagraphOptions } from "../../src/ooxml/paragraph";
import type { RunOptions } from "../../src/ooxml/run";
import { childNamed, parseXml, serializeXml, type XmlElement } from "../../src/read/xml";

async function firstParagraph(paragraph: docx.Paragraph): Promise<XmlElement | null> {
  const document = new docx.Document({ sections: [{ children: [paragraph] }] });
  const files = unzipSync(new Uint8Array(await docx.Packer.toBuffer(document)));
  const body = childNamed(parseXml(strFromU8(files["word/document.xml"])), "w:body");
  return childNamed(body, "w:p");
}

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
