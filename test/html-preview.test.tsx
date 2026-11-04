/** AC13: DocxPreview draws resolved documents as HTML, rendered through react-dom/server (no DOM here). */

import { PageNumber } from "docx";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DocxPreview, renderToTree, resolveDocument, type ResolvedBlock } from "../src/html/index";
import {
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  PageBreak,
  InternalHyperlink,
  Paragraph,
  Section,
  Table,
  TableCell,
  TableRow,
  TextRun,
  renderToBuffer,
} from "../src/index";
import { readDocx } from "../src/read/index";
import type { DocumentNode } from "../src/schema/elements";
import { WORD_SHAPED } from "./fixtures/word-shaped";
import { CASES } from "./support/cases";

async function readCase(name: string): Promise<DocumentNode> {
  const found = CASES.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no case ${name}`);
  return readDocx(new Uint8Array(await renderToBuffer(found.element))).document;
}

function readWordShaped(name: string): DocumentNode {
  const found = WORD_SHAPED.find((f) => f.name === name);
  if (found === undefined) throw new Error(`no Word-shaped fixture ${name}`);
  return readDocx(found.bytes).document;
}

const cell = (text: string, verticalMerge?: "restart" | "continue") => (
  <TableCell verticalMerge={verticalMerge}>
    <Paragraph>
      <TextRun text={text} />
    </Paragraph>
  </TableCell>
);

/** Authored, not read: no phase-1 case has a vertical merge. */
const MERGED_TABLE = renderToTree(
  <Document>
    <Section>
      <Table>
        <TableRow>
          {cell("merged", "restart")}
          {cell("a")}
        </TableRow>
        <TableRow>
          {cell("", "continue")}
          {cell("b")}
        </TableRow>
        <TableRow>
          {cell("", "continue")}
          {cell("c")}
        </TableRow>
      </Table>
    </Section>
  </Document>
);

const html = (document: DocumentNode): string => renderToStaticMarkup(<DocxPreview document={document} />);

/** Every block resolveDocument produces, nested ones included. */
function allBlocks(blocks: readonly ResolvedBlock[]): ResolvedBlock[] {
  return blocks.flatMap((block): ResolvedBlock[] => {
    switch (block.kind) {
      case "table":
        return [block, ...allBlocks(block.rows.flatMap((row) => row.cells.flatMap((c) => c.blocks)))];
      case "textbox":
        return [block, ...allBlocks(block.blocks)];
      default:
        return [block];
    }
  });
}

const pathAttr = (block: ResolvedBlock): string => `data-docx-path="${block.path.join(".")}"`;

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("DocxPreview", () => {
  const inputs: readonly [string, () => Promise<DocumentNode>][] = [
    ["image", () => readCase("image")],
    ["tab-break-pagebreak", () => readCase("tab-break-pagebreak")],
    ["bug-lists", () => readCase("bug-lists")],
    ["word-shaped resume", async () => readWordShaped("resume")],
    ["authored vertical merge", async () => MERGED_TABLE],
  ];

  test.each(inputs)("%s: every resolved block carries its data-docx-path", async (_name, input) => {
    const document = await input();
    const out = html(document);
    const pages = resolveDocument(document);
    const blocks = allBlocks(
      pages.flatMap((p) => [...p.header, ...p.parts.flatMap((part) => part.blocks), ...p.footer, ...p.footnotes.flatMap((note) => note.blocks)])
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(out).toContain(pathAttr(block));
  });

  test.each(inputs)("%s: one data-docx-page per resolved page, at least a page tall", async (_name, input) => {
    const document = await input();
    const pages = resolveDocument(document);
    const out = html(document);
    expect(pages.length).toBeGreaterThan(0);
    expect(count(out, "data-docx-page=")).toBe(pages.length);
    expect(out).toContain(`min-height:${pages[0].heightPt}pt`);
  });

  test("a pageBreakBefore paragraph starts its own sheet, with no CSS page break inside the sheet", () => {
    const out = html(
      renderToTree(
        <Document>
          <Section>
            <Paragraph>one</Paragraph>
            <Paragraph pageBreakBefore>two</Paragraph>
          </Section>
        </Document>
      )
    );
    expect(count(out, "data-docx-page=")).toBe(2);
    expect(out).not.toContain("break-before");
  });

  test("draws the header's first block before the body's first block", () => {
    const document = readWordShaped("resume");
    const [page] = resolveDocument(document);
    expect(page.header.length).toBeGreaterThan(0);
    const out = html(document);
    const header = out.indexOf(pathAttr(page.header[0]));
    const body = out.indexOf(pathAttr(page.parts[0].blocks[0]));
    expect(header).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(header);
  });

  test("draws an image as a data URL", async () => {
    const out = html(await readCase("image"));
    expect(out).toContain('<img src="data:image/png;base64,');
    expect(out).toContain('width="10" height="10"');
  });

  test("spans a vertically merged cell over its rows", () => {
    const out = html(MERGED_TABLE);
    expect(out).toContain('rowspan="3"');
    expect(count(out, "<td")).toBe(4);
  });

  test("draws list markers", async () => {
    const out = html(await readCase("bug-lists"));
    expect(out).toMatch(/<span data-docx-marker=""[^>]*>1\.<\/span>/);
    expect(out).toMatch(/<span data-docx-marker=""[^>]*>2\.<\/span>/);
  });

  test("a page break starts the next page", () => {
    const document = renderToTree(
      <Document>
        <Section>
          <Paragraph>
            one
            <PageBreak />
            two
          </Paragraph>
        </Section>
      </Document>
    );
    const out = html(document);
    expect(count(out, "data-docx-page=")).toBe(2);
    expect(out.indexOf("two")).toBeGreaterThan(out.indexOf('data-docx-page="2"'));
  });

  test("a page field shows its page's number, and a page-count field the document's page count", () => {
    const document = renderToTree(
      <Document>
        <Section>
          <Footer>
            <Paragraph>
              <TextRun>
                {"Page "}
                {PageNumber.CURRENT}
                {" of "}
                {PageNumber.TOTAL_PAGES}
              </TextRun>
            </Paragraph>
          </Footer>
          <Paragraph>
            one
            <PageBreak />
            two
          </Paragraph>
        </Section>
      </Document>
    );
    const fields = [...html(document).matchAll(/<span data-docx-field=""[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(fields).toEqual(["1", "2", "2", "2"]);
  });

  test("keeps a page break's following text in the same paragraph", async () => {
    // A <p> would be closed by the <hr> when the markup is parsed, pushing the rest of the line out of it.
    const out = html(await readCase("tab-break-pagebreak"));
    expect(out).not.toMatch(/<p[ >]/);
  });

  test("a javascript: link read back from a .docx draws its text with no href", async () => {
    const authored = (
      <Document>
        <Section>
          <Paragraph>
            <ExternalHyperlink link="javascript:alert(document.cookie)">
              <TextRun text="click" />
            </ExternalHyperlink>
          </Paragraph>
        </Section>
      </Document>
    );
    const out = html(readDocx(new Uint8Array(await renderToBuffer(authored))).document);
    expect(out).toContain("click");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a");
  });

  test.each([" JavaScript:alert(1)", "java\tscript:alert(1)", "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>"])(
    "draws %j as text with no href",
    (link) => {
      const out = html(
        renderToTree(
          <Document>
            <Section>
              <Paragraph>
                <ExternalHyperlink link={link}>
                  <TextRun text="click" />
                </ExternalHyperlink>
              </Paragraph>
            </Section>
          </Document>
        )
      );
      expect(out).toContain("click");
      expect(out).not.toContain("href=");
    }
  );

  test("draws http, https, mailto and bookmark links with their href, styled only by their runs", () => {
    const out = html(
      renderToTree(
        <Document>
          <Section>
            <Paragraph>
              <Bookmark id="top">
                <TextRun text="Top" />
              </Bookmark>
              <ExternalHyperlink link="https://example.com/a?b=1">
                <TextRun text="secure" />
              </ExternalHyperlink>
              <ExternalHyperlink link="http://example.com/">
                <TextRun text="plain" />
              </ExternalHyperlink>
              <ExternalHyperlink link="mailto:me@example.com">
                <TextRun text="mail" />
              </ExternalHyperlink>
              <InternalHyperlink anchor="top">
                <TextRun text="back" />
              </InternalHyperlink>
            </Paragraph>
          </Section>
        </Document>
      )
    );
    expect(out).toContain('<a href="https://example.com/a?b=1" style="color:inherit;text-decoration:none">');
    expect(out).toContain('<a href="http://example.com/" style="color:inherit;text-decoration:none">');
    expect(out).toContain('<a href="mailto:me@example.com" style="color:inherit;text-decoration:none">');
    expect(out).toContain('<a href="#top" style="color:inherit;text-decoration:none">');
  });

  test("forwards className and other div props to its root", () => {
    const out = renderToStaticMarkup(<DocxPreview document={MERGED_TABLE} className="my-preview" aria-label="Preview" />);
    expect(out).toMatch(/^<div(?=[^>]*\bdata-docx-preview="")(?=[^>]*\bclass="my-preview")(?=[^>]*\baria-label="Preview")[^>]*>/);
  });

  test("forwards its ref", () => {
    const component: unknown = DocxPreview;
    expect(component).toMatchObject({ $$typeof: Symbol.for("react.forward_ref") });
  });
});
