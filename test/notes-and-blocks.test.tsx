import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  Comment,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  Footer,
  Footnote,
  Paragraph,
  Section,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  Textbox,
  TextRun,
  TreeError,
  renderToBuffer,
  renderToTree,
} from "../src/index";
import { docxXml } from "./support/docx-xml";

/** The rendered parts with docxXml's pretty-printing undone, so one element sits on one line. */
async function parts(element: ReactElement): Promise<Record<string, string>> {
  const pretty = docxXml(await renderToBuffer(element));
  return Object.fromEntries(Object.entries(pretty).map(([name, xml]) => [name, xml.replaceAll("\n", "")]));
}

const body = (...blocks: ReactElement[]) => (
  <Document>
    <Section>{blocks}</Section>
  </Document>
);

describe("footnotes", () => {
  test("are numbered 1, 2, 3 in body order: a Section paragraph, a TableCell paragraph, the next Section", async () => {
    const xml = await parts(
      <Document>
        <Section>
          <Paragraph>
            a<Footnote>first</Footnote>
          </Paragraph>
          <Table>
            <TableRow>
              <TableCell>
                <Paragraph>
                  b<Footnote>second</Footnote>
                </Paragraph>
              </TableCell>
            </TableRow>
          </Table>
        </Section>
        <Section>
          <Paragraph>
            c<Footnote>third</Footnote>
          </Paragraph>
        </Section>
      </Document>
    );
    const references = [...xml["word/document.xml"].matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)];
    expect(references.map(([, id]) => id)).toEqual(["1", "2", "3"]);
    const notes = [...xml["word/footnotes.xml"].matchAll(/<w:footnote w:id="(\d+)">.*?>([a-z]+)<\/w:t>/g)];
    expect(notes.map(([, id, text]) => [id, text])).toEqual([
      ["1", "first"],
      ["2", "second"],
      ["3", "third"],
    ]);
  });

  test("<Footnote>text</Footnote> writes the text inside <w:footnote w:id=\"1\">", async () => {
    const xml = await parts(body(<Paragraph key="p">Claim<Footnote>Source: 2026 report</Footnote></Paragraph>));
    expect(xml["word/footnotes.xml"]).toMatch(
      /<w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteRef\/><\/w:r><w:r><w:t xml:space="preserve">Source: 2026 report<\/w:t><\/w:r><\/w:p><\/w:footnote>/
    );
  });

  test("a second document starts again at 1", async () => {
    const one = () => body(<Paragraph key="p">x<Footnote>note</Footnote></Paragraph>);
    await renderToBuffer(one());
    expect((await parts(one()))["word/document.xml"]).toContain('<w:footnoteReference w:id="1"/>');
  });

  test("a Footnote inside a Footer throws a TreeError", () => {
    const element = (
      <Document>
        <Section>
          <Footer>
            <Paragraph>
              <Footnote>no</Footnote>
            </Paragraph>
          </Footer>
        </Section>
      </Document>
    );
    expect(() => renderToTree(element)).toThrow(TreeError);
    expect(() => renderToTree(element)).toThrow("Footnote is only allowed in the document body");
  });
});

describe("comments", () => {
  const marked = (id: number) => (
    <Paragraph key="p">
      <CommentRangeStart id={id} />
      <TextRun>marked</TextRun>
      <CommentRangeEnd id={id} />
      <CommentReference id={id} />
    </Paragraph>
  );

  test("ranges and the reference are written around the run, and the comment into comments.xml", async () => {
    const xml = await parts(
      <Document>
        <Comment id={0} author="Ada" date={new Date("2026-01-01T00:00:00Z")}>
          c0
        </Comment>
        <Section>{marked(0)}</Section>
      </Document>
    );
    expect(xml["word/document.xml"]).toContain(
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve">marked</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>'
    );
    expect(xml["word/comments.xml"]).toContain(
      '<w:comment w:id="0" w:author="Ada" w:date="2026-01-01T00:00:00.000Z"><w:p><w:r><w:t xml:space="preserve">c0</w:t></w:r></w:p></w:comment>'
    );
  });

  test("a Comment without a date writes no w:date, so every render is the same", async () => {
    const xml = await parts(
      <Document>
        <Comment id={0} author="Ada">
          c0
        </Comment>
        <Section>{marked(0)}</Section>
      </Document>
    );
    expect(xml["word/comments.xml"]).toContain('<w:comment w:id="0" w:author="Ada"><w:p>');
  });

  test("a range id with no Comment throws", () => {
    const element = (
      <Document>
        <Comment id={0}>c0</Comment>
        <Section>{marked(1)}</Section>
      </Document>
    );
    expect(() => renderToTree(element)).toThrow("No <Comment id={1}>");
  });

  test("a duplicate Comment id throws", () => {
    const element = (
      <Document>
        <Comment id={0}>a</Comment>
        <Comment id={0}>b</Comment>
        <Section>{marked(0)}</Section>
      </Document>
    );
    expect(() => renderToTree(element)).toThrow("Document > Comment[1]: A second <Comment id={0}>");
  });
});

test("a TableOfContents writes a w:sdt holding the TOC field", async () => {
  const xml = await parts(body(<TableOfContents key="toc" alias="Contents" headingStyleRange="1-3" hyperlink />));
  const document = xml["word/document.xml"];
  expect(document).toContain('<w:sdt><w:sdtPr><w:alias w:val="Contents"/></w:sdtPr>');
  expect(document).toContain('<w:instrText xml:space="preserve">TOC \\h \\o &quot;1-3&quot;</w:instrText>');
});

test("an empty Textbox writes one empty paragraph into w:txbxContent", async () => {
  const xml = await parts(body(<Textbox key="box" style={{ width: "200pt", height: "50pt" }} />));
  expect(xml["word/document.xml"]).toContain("<w:txbxContent><w:p/></w:txbxContent>");
});

test("a Textbox writes its paragraphs into w:txbxContent", async () => {
  const xml = await parts(
    body(
      <Textbox key="box" style={{ width: "200pt", height: "50pt" }}>
        <Paragraph>in box</Paragraph>
      </Textbox>
    )
  );
  expect(xml["word/document.xml"]).toContain(
    '<w:txbxContent><w:p><w:r><w:t xml:space="preserve">in box</w:t></w:r></w:p></w:txbxContent>'
  );
});
