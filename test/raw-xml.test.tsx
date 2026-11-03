import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  Document,
  Paragraph,
  RawXml,
  Section,
  Table,
  TableCell,
  TableRow,
  TextRun,
  TreeError,
  renderToBuffer,
} from "../src/index";
import { docxXml } from "./support/docx-xml";

/** A rendered part with docxXml's pretty-printing undone, so it compares against a fragment as authored. */
async function part(element: ReactElement, name: string): Promise<string> {
  return docxXml(await renderToBuffer(element))[name].replaceAll("\n", "");
}

const documentXml = (element: ReactElement) => part(element, "word/document.xml");

const body = (...blocks: ReactElement[]) => (
  <Document>
    <Section>{blocks}</Section>
  </Document>
);

describe("RawXml is written verbatim", () => {
  test("in a block position, between the Section's paragraphs", async () => {
    const sdt = "<w:sdt><w:sdtContent><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>";
    const xml = await documentXml(body(<RawXml key="raw" xml={sdt} />, <Paragraph key="after">after</Paragraph>));
    expect(xml).toContain(`<w:body>${sdt}<w:p><w:r><w:t xml:space="preserve">after</w:t></w:r></w:p>`);
  });

  test("in an inline position, keeping the spaces of its text", async () => {
    const run = '<w:r><w:t xml:space="preserve"> sp a </w:t></w:r>';
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml={run} /></Paragraph>));
    expect(xml).toContain(`<w:p>${run}</w:p>`);
  });

  test("a whitespace-only text keeps its space", async () => {
    const run = '<w:r><w:t xml:space="preserve"> </w:t></w:r>';
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml={run} /></Paragraph>));
    expect(xml).toContain(`<w:p>${run}</w:p>`);
  });

  test("a pretty-printed fragment keeps every element and drops the indentation between them", async () => {
    const pretty = '<w:p>\n  <w:pPr><w:jc w:val="center"/></w:pPr>\n  <w:r><w:t>hi</w:t></w:r>\n</w:p>';
    const xml = await documentXml(body(<RawXml key="raw" xml={pretty} />));
    expect(xml).toContain('<w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>hi</w:t></w:r></w:p>');
  });

  test("CDATA is written as escaped text", async () => {
    const run = "<w:r><w:t>x<![CDATA[ <a> & b ]]></w:t></w:r>";
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml={run} /></Paragraph>));
    expect(xml).toContain("<w:p><w:r><w:t>x &lt;a&gt; &amp; b </w:t></w:r></w:p>");
  });

  test("a comment or processing instruction inside text is dropped, and the text around it kept", async () => {
    const run = "<w:r><w:t>a<!--c-->b<?p?>c<![CDATA[d]]></w:t></w:r>";
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml={run} /></Paragraph>));
    expect(xml).toContain("<w:p><w:r><w:t>abcd</w:t></w:r></w:p>");
  });

  test("whitespace written as CDATA or a character reference between elements is dropped, not the elements", async () => {
    const run = "<w:r><w:t>a</w:t><![CDATA[ ]]>&#32;<w:tab/></w:r>";
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml={run} /></Paragraph>));
    expect(xml).toContain("<w:p><w:r><w:t>a</w:t><w:tab/></w:r></w:p>");
  });

  test("a space after an element is dropped, not the element", async () => {
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml="<w:r><w:t>x</w:t> </w:r>" /></Paragraph>));
    expect(xml).toContain("<w:p><w:r><w:t>x</w:t></w:r></w:p>");
  });

  test("a space between two elements is dropped, and both elements kept", async () => {
    const xml = await documentXml(body(<Paragraph key="p"><RawXml xml="<w:r><w:t>x</w:t> <w:tab/></w:r>" /></Paragraph>));
    expect(xml).toContain("<w:p><w:r><w:t>x</w:t><w:tab/></w:r></w:p>");
  });

  test("as run content, every element of the fragment lands in the same run, after the text before it", async () => {
    const field =
      '<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> DATE </w:instrText><w:fldChar w:fldCharType="end"/>';
    const xml = await documentXml(
      body(
        <Paragraph key="p">
          <TextRun>
            x<RawXml xml={field} />
          </TextRun>
        </Paragraph>
      )
    );
    expect(xml).toContain(`<w:p><w:r><w:t xml:space="preserve">x</w:t>${field}</w:r></w:p>`);
  });

  test("in a TableCell, before the cell's closing Paragraph", async () => {
    const raw = "<w:p><w:r><w:t>raw</w:t></w:r></w:p>";
    const xml = await documentXml(
      body(
        <Table key="t">
          <TableRow>
            <TableCell>
              <RawXml xml={raw} />
              <Paragraph>end</Paragraph>
            </TableCell>
          </TableRow>
        </Table>
      )
    );
    expect(xml).toContain(`<w:tc>${raw}<w:p><w:r><w:t xml:space="preserve">end</w:t></w:r></w:p></w:tc>`);
  });
});

describe("styles.importedStyles", () => {
  test("a raw <w:style> lands in styles.xml next to docx.js's defaults", async () => {
    const tableGrid = '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>';
    const styles = await part(
      <Document styles={{ importedStyles: [tableGrid] }}>
        <Section />
      </Document>,
      "word/styles.xml"
    );
    expect(styles).toContain(tableGrid);
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain("<w:docDefaults>");
  });
});

describe("unsafe RawXml is rejected with a TreeError", () => {
  async function rejection(element: ReactElement): Promise<TreeError> {
    const error = await renderToBuffer(element).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    if (error instanceof TreeError) return error;
    throw new Error(`expected a TreeError, got ${String(error)}`);
  }

  test("a relationship reference", async () => {
    const drawing = '<w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r>';
    const error = await rejection(body(<Paragraph key="p"><RawXml xml={drawing} /></Paragraph>));
    expect(error.path).toEqual(["Document", "Section[0]", "Paragraph[0]", "RawXml[0]"]);
    expect(error.message).toContain("RawXml cannot carry relationship references (r:id, r:embed, …)");
  });

  test("a root that does not belong in its slot", async () => {
    const error = await rejection(body(<Paragraph key="p"><RawXml xml="<w:p/>" /></Paragraph>));
    expect(error.message).toBe("Document > Section[0] > Paragraph[0] > RawXml[0]: RawXml <w:p> is not allowed in <Paragraph>");
  });

  test("a TableCell whose last child is RawXml", async () => {
    const error = await rejection(
      body(
        <Table key="t">
          <TableRow>
            <TableCell>
              <RawXml xml="<w:p/>" />
            </TableCell>
          </TableRow>
        </Table>
      )
    );
    expect(error.message).toBe("Document > Section[0] > Table[0] > TableRow[0] > TableCell[0]: A TableCell must end with a <Paragraph>");
  });

  test("an imported style whose id docx.js already defines", async () => {
    const heading = '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>';
    const error = await rejection(
      <Document styles={{ importedStyles: [heading] }}>
        <Section />
      </Document>
    );
    expect(error.message).toBe('Document: styles.importedStyles[0] defines style "Heading1", which is already defined');
  });
});
