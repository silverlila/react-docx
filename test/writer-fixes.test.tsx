import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { HeadingLevel } from "docx";
import {
  Document,
  List,
  ListItem,
  Math,
  Paragraph,
  Section,
  SymbolRun,
  Tab,
  TextRun,
  renderToBuffer,
} from "../src/index";
import { docxXml } from "./support/docx-xml";

async function parts(element: ReactElement): Promise<Record<string, string>> {
  const pretty = docxXml(await renderToBuffer(element));
  return Object.fromEntries(Object.entries(pretty).map(([name, xml]) => [name, xml.replaceAll("\n", "")]));
}

async function documentXml(element: ReactElement): Promise<string> {
  return (await parts(element))["word/document.xml"];
}

function paragraphs(xml: string): string[] {
  return xml.match(/<w:p>.*?<\/w:p>/g) ?? [];
}

function paragraphWithText(xml: string, text: string): string {
  const found = paragraphs(xml).find((p) => p.includes(`>${text}</w:t>`));
  if (found === undefined) throw new Error(`no paragraph holds "${text}"`);
  return found;
}

function numIds(xml: string): string[] {
  return [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(([, id]) => id);
}

const body = (...blocks: ReactElement[]) => (
  <Document>
    <Section>{blocks}</Section>
  </Document>
);

describe("writer fixes", () => {
  test("a Tab inside a TextRun is written in that run, not in a run nested inside it", async () => {
    const xml = await documentXml(
      body(
        <Paragraph key="p">
          <TextRun>
            a<Tab />b
          </TextRun>
        </Paragraph>,
      ),
    );
    const paragraph = paragraphWithText(xml, "a");
    expect(/<w:r>(?:(?!<\/w:r>).)*<w:r>/.test(paragraph)).toBe(false);
    expect(paragraph).toContain(
      '<w:r><w:t xml:space="preserve">a</w:t><w:tab/><w:t xml:space="preserve">b</w:t></w:r>',
    );
  });

  test("Math keeps its text", async () => {
    const xml = await documentXml(
      body(
        <Paragraph key="p">
          <Math text="x+1" />
        </Paragraph>,
      ),
    );
    expect(xml).toContain("<m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath>");
  });

  test("SymbolRun keeps its font and run formatting", async () => {
    const xml = await documentXml(
      body(
        <Paragraph key="p">
          <SymbolRun char="F071" symbolfont="Symbol" bold />
        </Paragraph>,
      ),
    );
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:sym w:char="F071" w:font="Symbol"/></w:r>');
  });

  describe("lists", () => {
    test("two separate numbered lists each restart: they get distinct w:numId values", async () => {
      const xml = await documentXml(
        body(
          <List key="1" type="numbered">
            <ListItem>first</ListItem>
          </List>,
          <List key="2" type="numbered">
            <ListItem>second</ListItem>
          </List>,
        ),
      );
      const [first] = numIds(paragraphWithText(xml, "first"));
      const [second] = numIds(paragraphWithText(xml, "second"));
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
    });

    test("a nested list's items sit at level 1 of the same numbering", async () => {
      const xml = await documentXml(
        body(
          <List key="l" type="numbered">
            <ListItem>a</ListItem>
            <List type="numbered">
              <ListItem>b</ListItem>
            </List>
          </List>,
        ),
      );
      expect(paragraphWithText(xml, "a")).toContain('<w:ilvl w:val="0"/>');
      expect(paragraphWithText(xml, "b")).toContain('<w:ilvl w:val="1"/>');
      expect(numIds(paragraphWithText(xml, "b"))).toEqual(numIds(paragraphWithText(xml, "a")));
    });

    test("the numbered list's abstract numbering defines level 1", async () => {
      const written = await parts(
        body(
          <List key="l" type="numbered">
            <ListItem>a</ListItem>
          </List>,
        ),
      );
      const [numId] = numIds(paragraphWithText(written["word/document.xml"], "a"));
      const numbering = written["word/numbering.xml"];
      const abstractId = numbering.match(
        new RegExp(`<w:num w:numId="${numId}"><w:abstractNumId w:val="(\\d+)"/>`),
      )?.[1];
      const abstract = numbering.match(
        new RegExp(`<w:abstractNum w:abstractNumId="${abstractId}"[^>]*>.*?</w:abstractNum>`),
      )?.[0];
      expect(abstract).toContain('<w:lvl w:ilvl="1"');
      expect(abstract).toContain('<w:numFmt w:val="decimal"/>');
    });
  });

  test("heading with an equal style writes one w:pStyle", async () => {
    const xml = await documentXml(
      body(
        <Paragraph key="p" heading={HeadingLevel.HEADING_1} style="Heading1">
          <TextRun text="heading" />
        </Paragraph>,
      ),
    );
    expect(paragraphWithText(xml, "heading").match(/<w:pStyle /g)).toHaveLength(1);
  });

  test("a paragraphStyles entry with a docx.js default id is defined once, with the author's formatting", async () => {
    const written = await parts(
      <Document
        styles={{
          paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { color: "FF0000" } },
          ],
        }}
      >
        <Section>
          <Paragraph heading={HeadingLevel.HEADING_1}>red heading</Paragraph>
        </Section>
      </Document>,
    );
    const styles = written["word/styles.xml"];
    expect(styles.match(/w:styleId="Heading1"/g)).toHaveLength(1);
    const heading1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[^>]*>.*?<\/w:style>/)?.[0];
    expect(heading1).toContain('<w:color w:val="FF0000"/>');
  });
});
