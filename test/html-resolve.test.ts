import { HeadingLevel } from "docx";
import { createElement as h, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import {
  ColumnBreak,
  Document,
  Footnote,
  Header,
  ImageRun,
  InternalHyperlink,
  PageBreak,
  Paragraph,
  RawXml,
  Section,
  Tab,
  Textbox,
  Table,
  TableCell,
  TableRow,
  TextRun,
  renderToBuffer,
  renderToTree,
} from "../src/index";
import { borderCss, paragraphStyle, runStyle } from "../src/html/css";
import { fontFamilyCss } from "../src/html/fonts";
import { tabLayout } from "../src/html/tabs";
import { DocxPreview } from "../src/html/preview";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCX_DEFAULT_STYLES } from "../src/html/docx-default-styles.generated";
import type { ResolvedPage } from "../src/html/pages";
import { resolveDocument, type ResolvedBlock, type ResolvedInline } from "../src/html/resolve";
import { readDocx } from "../src/read/index";
import type { DocumentNode } from "../src/schema/elements";
import { WORD_SHAPED } from "./fixtures/word-shaped";
import { PNG_1PX } from "./support/cases";

type Paragraph = Extract<ResolvedBlock, { kind: "paragraph" }>;
type Table = Extract<ResolvedBlock, { kind: "table" }>;
type Text = Extract<ResolvedInline, { kind: "text" }>;

const doc = (props: Record<string, unknown>, ...children: ReactNode[]) =>
  resolveDocument(renderToTree(h(Document, props, h(Section, null, ...children))));

/** Every page's body blocks, in order. */
const body = (pages: readonly ResolvedPage[]): readonly ResolvedBlock[] => pages.flatMap((page) => page.parts.flatMap((part) => part.blocks));

function paragraphAt(blocks: readonly ResolvedBlock[], i: number): Paragraph {
  const block = blocks[i];
  if (block.kind !== "paragraph") throw new Error(`block ${i} is a ${block.kind}`);
  return block;
}

function tableAt(blocks: readonly ResolvedBlock[], i: number): Table {
  const block = blocks[i];
  if (block.kind !== "table") throw new Error(`block ${i} is a ${block.kind}`);
  return block;
}

function textAt(inlines: readonly ResolvedInline[], i: number): Text {
  const inline = inlines[i];
  if (inline.kind !== "text") throw new Error(`inline ${i} is a ${inline.kind}`);
  return inline;
}

const textOf = (p: Paragraph): string => p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("");

function paragraphWithText(blocks: readonly ResolvedBlock[], text: string): Paragraph {
  const found = blocks.find((b): b is Paragraph => b.kind === "paragraph" && textOf(b) === text);
  if (found === undefined) throw new Error(`no paragraph "${text}"`);
  return found;
}

describe("the docx.js default-style snapshot", () => {
  test("matches what docx.js writes now (run `pnpm run generate:styles` on drift)", async () => {
    const empty: DocumentNode = {
      type: "Document",
      props: {},
      children: [{ type: "Section", props: {}, children: [{ type: "Paragraph", props: {}, children: [] }] }],
    };
    const { document } = readDocx(new Uint8Array(await renderToBuffer(empty)));
    expect(document.props.styles).toEqual(DOCX_DEFAULT_STYLES);
  });
});

describe("the style cascade", () => {
  test("a heading the document never defines gets docx.js's built-in Heading1", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, { heading: HeadingLevel.HEADING_1 }, "Title"))), 0);
    expect(textAt(p.inlines, 0).run).toMatchObject({ color: "2E74B5", sizePt: 16 });
  });

  test("an authored default style replaces docx.js's options shallowly, as docx.js writes it", () => {
    const styles = { default: { heading1: { run: { size: 40 } } } };
    const p = paragraphAt(body(doc({ styles }, h(Paragraph, { heading: HeadingLevel.HEADING_1 }, "Title"))), 0);
    expect(textAt(p.inlines, 0).run).toMatchObject({ color: null, sizePt: 20 });
  });

  test("with no font or size anywhere, runs use Times New Roman at 10pt", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, null, "Plain"))), 0);
    expect(textAt(p.inlines, 0).run).toMatchObject({ fontFamily: "Times New Roman", sizePt: 10, color: null });
  });

  test("a raw style marked w:default is the style of every paragraph that names none", () => {
    const normal =
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style>';
    const p = paragraphAt(body(doc({ styles: { importedStyles: [normal] } }, h(Paragraph, null, "Plain"))), 0);
    expect(textAt(p.inlines, 0).run).toMatchObject({ fontFamily: "Arial", sizePt: 12 });
    expect(p.format.spaceAfterPt).toBe(10);
  });

  test("every style in an importedStyles entry applies, not only the first", () => {
    const styles =
      '<w:style w:type="character" w:styleId="Accent"><w:name w:val="Accent"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>';
    const blocks = body(
      doc({ styles: { importedStyles: [styles] } }, h(Paragraph, null, h(TextRun, { style: "Accent" }, "plain")), h(Paragraph, { style: "Quote" }, "quoted"))
    );
    expect(textAt(paragraphAt(blocks, 0).inlines, 0).run).toMatchObject({ color: "FF0000", sizePt: 12 });
    expect(textAt(paragraphAt(blocks, 1).inlines, 0).run).toMatchObject({ italic: true });
  });

  test("a basedOn chain of three styles applies base first", () => {
    const styles = {
      paragraphStyles: [
        { id: "Base", run: { font: "Georgia", size: 20, color: "111111", italics: true } },
        { id: "Middle", basedOn: "Base", run: { size: 30, color: "222222" }, paragraph: { spacing: { before: 120, after: 60 } } },
        { id: "Top", basedOn: "Middle", run: { color: "333333" }, paragraph: { spacing: { after: 240 } } },
      ],
    };
    const p = paragraphAt(body(doc({ styles }, h(Paragraph, { style: "Top" }, "Chained"))), 0);
    expect(textAt(p.inlines, 0).run).toMatchObject({ fontFamily: "Georgia", sizePt: 15, color: "333333", italic: true });
    expect(p.format).toMatchObject({ spaceBeforePt: 6, spaceAfterPt: 12 });
  });

  test("a character style overrides the paragraph style's run, and direct props override both", () => {
    const styles = {
      paragraphStyles: [{ id: "Body", run: { color: "111111", bold: true, size: 30 } }],
      characterStyles: [{ id: "Accent", run: { color: "222222", size: 40 } }],
    };
    const p = paragraphAt(
      body(
        doc(
          { styles },
          h(
            Paragraph,
            { style: "Body" },
            h(TextRun, null, "plain"),
            h(TextRun, { style: "Accent" }, "accent"),
            h(TextRun, { style: "Accent", color: "333333" }, "direct")
          )
        )
      ),
      0
    );
    expect(textAt(p.inlines, 0).run).toMatchObject({ color: "111111", sizePt: 15, bold: true });
    expect(textAt(p.inlines, 1).run).toMatchObject({ color: "222222", sizePt: 20, bold: true });
    expect(textAt(p.inlines, 2).run).toMatchObject({ color: "333333", sizePt: 20, bold: true });
  });

  test("an authored table with no borders shows the single borders docx.js writes on every table", () => {
    const table = tableAt(
      body(doc({}, h(Table, null, h(TableRow, null, h(TableCell, null, h(Paragraph, null, "a")), h(TableCell, null, h(Paragraph, null, "b")))))),
      0
    );
    const solid = { style: "solid", widthPt: 0.5, color: "000000" };
    expect(table.rows[0].cells.map((c) => c.borders)).toEqual([
      { top: solid, bottom: solid, left: solid, right: solid },
      { top: solid, bottom: solid, left: solid, right: solid },
    ]);
  });
});

describe("styles read from a Word file", () => {
  const resume = WORD_SHAPED.find((f) => f.name === "resume");
  if (resume === undefined) throw new Error("no Word-shaped resume fixture");
  const sections = resolveDocument(readDocx(resume.bytes).document);
  const blocks = body(sections);
  const [borderless, grid] = blocks.filter((b): b is Table => b.kind === "table");

  test("body text has the Normal style's font, resolved from the theme by the reader", () => {
    expect(textAt(paragraphWithText(blocks, "Analyst, London").inlines, 0).run).toMatchObject({
      fontFamily: "Calibri",
      sizePt: 11,
    });
  });

  test("a table with the raw Table Grid style has 0.5pt solid cell borders", () => {
    expect(grid.rows[0].cells.map((c) => c.borders.top)).toEqual([
      { style: "solid", widthPt: 0.5, color: "000000" },
      { style: "solid", widthPt: 0.5, color: "000000" },
    ]);
    expect(grid.rows[0].cells[0].borders).toMatchObject({ left: { widthPt: 0.5 }, right: { widthPt: 0.5 }, bottom: { widthPt: 0.5 } });
  });

  test("Table Grid's paragraph spacing applies to the paragraphs in its cells", () => {
    const cell = paragraphAt(grid.rows[0].cells[0].blocks, 0);
    expect(cell.format.lineHeight).toEqual({ kind: "multiple", value: 1 });
  });

  test("a table whose borders are none has no cell borders", () => {
    expect(borderless.rows[0].cells.map((c) => c.borders)).toEqual([{}, {}]);
  });
});

describe("list markers", () => {
  const numbering = {
    config: [
      {
        reference: "outline",
        levels: [
          { level: 0, format: "decimal", text: "%1.", style: { run: { bold: true } } },
          { level: 1, format: "decimal", text: "%1.%2.", suffix: "space" },
        ],
      },
      { reference: "dots", levels: [{ level: 0, format: "bullet", text: "•" }] },
    ],
  };
  const item = (reference: string, level: number, text: string) => h(Paragraph, { numbering: { reference, level } }, text);
  const blocks = body(
    doc(
      { numbering },
      item("outline", 0, "one"),
      item("outline", 0, "two"),
      item("outline", 1, "two.one"),
      item("dots", 0, "bullet")
    )
  );
  const markers = blocks.map((b) => (b.kind === "paragraph" ? b.marker : null));

  test("nested numbered markers render 1., 2., 2.1.", () => {
    expect(markers.slice(0, 3).map((m) => m?.text)).toEqual(["1.", "2.", "2.1."]);
  });

  test("bullets render their level text", () => {
    expect(markers[3]?.text).toBe("•");
  });

  test("the marker takes the level's run over the paragraph mark and the level's suffix", () => {
    expect(markers[0]).toMatchObject({ run: { bold: true, fontFamily: "Times New Roman" }, suffix: "tab" });
    expect(markers[2]).toMatchObject({ run: { bold: false }, suffix: "space" });
  });
});

describe("units", () => {
  const blocks = body(
    doc(
      {},
      h(Paragraph, { spacing: { line: 276, lineRule: "auto" } }, "auto"),
      h(Paragraph, { spacing: { line: 240, lineRule: "exact" } }, "exact"),
      h(Paragraph, { indent: { left: 720, hanging: 360 } }, "hanging"),
      h(Paragraph, { border: { bottom: { style: "single", size: 4, color: "auto" } } }, "border")
    )
  );

  test("line spacing: auto 276 is a 1.15 multiple, exact 240 is 12pt", () => {
    expect(paragraphAt(blocks, 0).format.lineHeight).toEqual({ kind: "multiple", value: 1.15 });
    expect(paragraphAt(blocks, 1).format.lineHeight).toEqual({ kind: "exact", pt: 12 });
    expect(paragraphStyle(paragraphAt(blocks, 1).format).lineHeight).toBe("12pt");
  });

  test("a multiple scales the font's own single line, as Word does: Times New Roman's is 1.15 of its size", () => {
    const auto = paragraphAt(blocks, 0);
    expect(paragraphStyle(auto.format).lineHeight).toBeCloseTo(1.15 * 1.1499, 4);
    expect(textAt(auto.inlines, 0).run.lineHeight).toBeCloseTo(1.15 * 1.1499, 4);
  });

  test("a line's height follows its tallest run: each run carries its own font's line height", () => {
    const p = paragraphAt(
      body(doc({}, h(Paragraph, null, h(TextRun, { font: "Calibri" }, "a"), h(TextRun, { font: "Arial" }, "b")))),
      0
    );
    expect(runStyle(textAt(p.inlines, 0).run).lineHeight).toBeCloseTo(1.2207, 4);
    expect(runStyle(textAt(p.inlines, 1).run).lineHeight).toBeCloseTo(1.1499, 4);
  });

  test("an exact line leaves its runs to inherit it; an atLeast line sets each run at its single height", () => {
    const [exact, atLeast] = body(
      doc(
        {},
        h(Paragraph, { spacing: { line: 300, lineRule: "exact" } }, h(TextRun, { font: "Calibri" }, "a")),
        h(Paragraph, { spacing: { line: 300, lineRule: "atLeast" } }, h(TextRun, { font: "Calibri" }, "b"))
      )
    ).map((_, i, all) => paragraphAt(all, i));
    expect(runStyle(textAt(exact.inlines, 0).run).lineHeight).toBeUndefined();
    expect(paragraphStyle(atLeast.format).lineHeight).toBe("15pt");
    expect(runStyle(textAt(atLeast.inlines, 0).run).lineHeight).toBeCloseTo(1.2207, 4);
  });

  test("hanging 360 is a first line of -18pt", () => {
    expect(paragraphAt(blocks, 2).format).toMatchObject({ indentLeftPt: 36, firstLinePt: -18 });
    expect(paragraphStyle(paragraphAt(blocks, 2).format)).toMatchObject({ marginInlineStart: "36pt", textIndent: "-18pt" });
  });

  test("a size 4 border is 0.5pt, and an auto colour draws black", () => {
    const bottom = paragraphAt(blocks, 3).format.borders.bottom;
    expect(bottom).toEqual({ style: "solid", widthPt: 0.5, color: "000000" });
    expect(bottom === undefined ? null : borderCss(bottom)).toBe("0.5pt solid #000000");
  });

  test("runs become pt sizes, quoted font names with a generic fallback, and hex colours", () => {
    const run = textAt(
      paragraphAt(body(doc({}, h(Paragraph, null, h(TextRun, { font: "Open Sans", size: 22, color: "auto", bold: true }, "x")))), 0).inlines,
      0
    ).run;
    expect(run.color).toBeNull();
    expect(runStyle(run)).toMatchObject({ fontFamily: '"Open Sans", sans-serif', fontSize: "11pt", fontWeight: "bold" });
    expect(runStyle({ ...run, color: "C00000" }).color).toBe("#C00000");
  });

  test("a section without page props is docx.js's A4 with 1-inch margins; landscape swaps", () => {
    const [portrait] = doc({}, h(Paragraph, null, "x"));
    expect(portrait).toMatchObject({ widthPt: 595.3, heightPt: 841.9, marginsPt: { top: 72, right: 72, bottom: 72, left: 72 } });
    const landscape = resolveDocument(
      renderToTree(h(Document, null, h(Section, { properties: { page: { size: { orientation: "landscape" } } } }, h(Paragraph, null, "x"))))
    );
    expect(landscape[0]).toMatchObject({ widthPt: 841.9, heightPt: 595.3 });
  });
});

describe("images", () => {
  const imageOf = (data: Uint8Array) => {
    const p = paragraphAt(body(doc({}, h(Paragraph, null, h(ImageRun, { type: "png", data, transformation: { width: 10, height: 20 } })))), 0);
    const image = p.inlines[0];
    if (image.kind !== "image") throw new Error(`inline is a ${image.kind}`);
    return image;
  };
  const decoded = (src: string): Uint8Array => Uint8Array.from(atob(src.split(",")[1]), (c) => c.charCodeAt(0));

  test("an image is a PNG data URL of its bytes", () => {
    const image = imageOf(PNG_1PX);
    expect(image.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(decoded(image.src)).toEqual(PNG_1PX);
    expect(image).toMatchObject({ widthPx: 10, heightPx: 20, float: null });
  });

  test("bytes longer than one 32 KiB chunk decode back whole", () => {
    const data = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256);
    expect(decoded(imageOf(data).src)).toEqual(data);
  });
});

describe("tables", () => {
  const cell = (text: string, props: Record<string, unknown> = {}) => h(TableCell, props, h(Paragraph, null, text));

  test("a vertical merge restart plus two continues spans 3 rows, and the continue cells are omitted", () => {
    const table = tableAt(
      body(
        doc(
          {},
          h(
            Table,
            null,
            h(TableRow, null, cell("merged", { verticalMerge: "restart" }), cell("a")),
            h(TableRow, null, cell("", { verticalMerge: "continue" }), cell("b")),
            h(TableRow, null, cell("", { verticalMerge: "continue" }), cell("c")),
            h(TableRow, null, cell("after"), cell("d"))
          )
        )
      ),
      0
    );
    expect(table.rows.map((r) => r.cells.map((c) => c.rowSpan))).toEqual([[3, 1], [1], [1], [1, 1]]);
    expect(table.rows[1].cells[0].blocks).toMatchObject([{ path: [0, 0, 1, 1, 0] }]);
  });

  test("a cell after a column span starts at the span's end", () => {
    const table = tableAt(
      body(
        doc(
          {},
          h(
            Table,
            null,
            h(TableRow, null, cell("wide", { columnSpan: 2, verticalMerge: "restart" }), cell("x")),
            h(TableRow, null, cell("", { columnSpan: 2, verticalMerge: "continue" }), cell("y"))
          )
        )
      ),
      0
    );
    expect(table.rows.map((r) => r.cells.map((c) => [c.colSpan, c.rowSpan]))).toEqual([[[2, 2], [1, 1]], [[1, 1]]]);
  });
});

describe("footnotes", () => {
  test("are numbered 1..n across the document and listed on the page that references them", () => {
    const note = (text: string) => h(Paragraph, null, text, h(Footnote, null, `note ${text}`));
    const pages = resolveDocument(
      renderToTree(h(Document, null, h(Section, null, note("a"), note("b")), h(Section, null, note("c"))))
    );
    const refs = body(pages).flatMap((b) => (b.kind === "paragraph" ? b.inlines : [])).filter((i) => i.kind === "footnoteRef");
    expect(refs.map((r) => (r.kind === "footnoteRef" ? r.n : 0))).toEqual([1, 2, 3]);
    expect(pages.map((p) => p.footnotes.map((f) => f.n))).toEqual([[1, 2], [3]]);
    expect(textOf(paragraphAt(pages[1].footnotes[0].blocks, 0))).toBe("note c");
    expect(refs[0]).toMatchObject({ run: { verticalAlign: "super" } });
  });
});

describe("pages", () => {
  const RENDERED = h(RawXml, { xml: "<w:lastRenderedPageBreak/>" });
  const pagesOf = (...sections: ReactNode[]) => resolveDocument(renderToTree(h(Document, null, ...sections)));
  const texts = (pages: readonly ResolvedPage[]) =>
    pages.map((page) => page.parts.flatMap((part) => part.blocks).map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind)));

  test("an authored page break moves the rest of its paragraph to a new page", () => {
    const pages = pagesOf(
      h(Section, null, h(Paragraph, { spacing: { before: 100, after: 200 }, indent: { firstLine: 360 } }, "one", h(PageBreak), "two"))
    );
    expect(texts(pages)).toEqual([["one"], ["two"]]);
    const [first, rest] = body(pages).map((_, i, all) => paragraphAt(all, i));
    expect(first.format).toMatchObject({ spaceBeforePt: 5, spaceAfterPt: 0, firstLinePt: 18 });
    expect(rest.format).toMatchObject({ spaceBeforePt: 0, spaceAfterPt: 10, firstLinePt: 0 });
  });

  test("a paragraph that ends with a page break leaves nothing on the next page; two breaks leave a blank page", () => {
    const pages = pagesOf(
      h(Section, null, h(Paragraph, null, "one", h(PageBreak)), h(Paragraph, null, h(PageBreak)), h(Paragraph, null, "three"))
    );
    expect(texts(pages)).toEqual([["one"], [], ["three"]]);
  });

  test("a section that ends with a page break leaves a blank page, which docx.js's section mark sits on, before the next", () => {
    const pages = pagesOf(h(Section, null, h(Paragraph, null, "one", h(PageBreak))), h(Section, null, h(Paragraph, null, "two")));
    expect(texts(pages)).toEqual([["one"], [], ["two"]]);
    expect(pages.map((page) => [page.number, page.section])).toEqual([["1", 1], ["2", 1], ["3", 2]]);
  });

  test("Word's rendered page break starts a page, but not right after an authored break", () => {
    const pages = pagesOf(
      h(
        Section,
        null,
        h(Paragraph, null, "one"),
        h(Paragraph, null, h(TextRun, null, RENDERED, "two")),
        h(Paragraph, null, h(PageBreak)),
        h(Paragraph, null, h(TextRun, null, RENDERED, "three"))
      )
    );
    expect(texts(pages)).toEqual([["one"], ["two"], ["three"]]);
  });

  test("a bookmark before a rendered break goes with the text after it, so a list marker is not left behind", () => {
    const pages = pagesOf(
      h(Section, null, h(Paragraph, null, "one"), h(Paragraph, null, h(RawXml, { xml: '<w:bookmarkStart w:id="1" w:name="a"/>' }), h(TextRun, null, RENDERED, "two")))
    );
    expect(texts(pages)).toEqual([["one"], ["two"]]);
  });

  test("pageBreakBefore starts a page unless the page is still empty", () => {
    const pages = pagesOf(
      h(Section, null, h(Paragraph, { pageBreakBefore: true }, "one"), h(Paragraph, { pageBreakBefore: true }, "two"))
    );
    expect(texts(pages)).toEqual([["one"], ["two"]]);
  });

  test("a continuous section continues the page in a part of its own; other sections start a page", () => {
    const pages = pagesOf(
      h(Section, null, h(Paragraph, null, "one")),
      h(Section, { properties: { type: "continuous", column: { count: 2, space: 720 } } }, h(Paragraph, null, "two")),
      h(Section, null, h(Paragraph, null, "three"))
    );
    expect(texts(pages)).toEqual([["one", "two"], ["three"]]);
    expect(pages[0].parts.map((part) => part.columns)).toEqual([null, { count: 2, spacePt: 36, separate: false }]);
  });

  test("in columns, Word's rendered breaks start the next column, then the next page; the first one opens the part", () => {
    const at = (text: string) => h(Paragraph, null, h(TextRun, null, RENDERED, text));
    const pages = pagesOf(
      h(Section, null, h(Paragraph, null, "intro")),
      h(Section, { properties: { type: "continuous", column: { count: 2 } } }, at("a"), h(Paragraph, null, "b"), at("c"), at("d")),
      h(Section, { properties: { type: "continuous" } }, at("after"))
    );
    expect(texts(pages)).toEqual([["intro", "a", "b", "c"], ["d", "after"]]);
    expect(pages[0].parts[1]).toMatchObject({ columnStarts: [0, 2] });
    expect(pages[1].parts.map((part) => part.columnStarts)).toEqual([null, null]);
  });

  test("a column break in one column starts a page", () => {
    const pages = pagesOf(h(Section, null, h(Paragraph, null, "one", h(ColumnBreak), "two")));
    expect(texts(pages)).toEqual([["one"], ["two"]]);
  });

  test("a table breaks before the row holding a rendered break and repeats its header rows", () => {
    const row = (text: ReactNode, tableHeader?: boolean) =>
      h(TableRow, { tableHeader }, h(TableCell, null, h(Paragraph, null, text)));
    const pages = pagesOf(
      h(Section, null, h(Table, null, row("head", true), row("a"), row(h(TextRun, null, RENDERED, "b")), row("c")))
    );
    const rowsOf = (page: ResolvedPage) =>
      page.parts[0].blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => textOf(paragraphAt(r.cells[0].blocks, 0))) : []));
    expect(pages.map(rowsOf)).toEqual([["head", "a"], ["head", "b", "c"]]);
  });

  test("numbers pages from a section's start, in its format", () => {
    const pages = pagesOf(
      h(Section, { properties: { page: { pageNumbers: { start: 4, formatType: "lowerRoman" } } } }, h(Paragraph, null, "a", h(PageBreak), "b")),
      h(Section, { properties: { page: { pageNumbers: { start: 1 } } } }, h(Paragraph, null, "c")),
      h(Section, null, h(Paragraph, null, "d"))
    );
    expect(pages.map((page) => page.number)).toEqual(["iv", "v", "1", "2"]);
  });

  test("a title page shows the first-page header; even pages the even header; a section inherits what it lacks", () => {
    const header = (type: string, text: string) => h(Header, { type }, h(Paragraph, null, text));
    const tree = renderToTree(
      h(
        Document,
        { evenAndOddHeaderAndFooters: true },
        h(
          Section,
          { properties: { titlePage: true } },
          header("default", "odd"),
          header("first", "first"),
          header("even", "even"),
          h(Paragraph, null, "1", h(PageBreak), "2", h(PageBreak), "3")
        ),
        h(Section, null, h(Paragraph, null, "4"))
      )
    );
    const headers = resolveDocument(tree).map((page) => page.header.map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind)).join());
    expect(headers).toEqual(["first", "even", "odd", "even"]);
  });
});

describe("fonts", () => {
  test("a font with a metric-compatible substitute lists it before the generic family", () => {
    expect(fontFamilyCss(["Calibri"])).toBe('"Calibri", "Carlito", sans-serif');
    expect(fontFamilyCss(["Times New Roman"])).toBe('"Times New Roman", "Liberation Serif", "Tinos", "Times", serif');
  });

  test("an unknown font's generic family is guessed from its name", () => {
    expect(fontFamilyCss(["Source Serif Pro"])).toMatch(/, serif$/);
    expect(fontFamilyCss(["Open Sans"])).toMatch(/, sans-serif$/);
    expect(fontFamilyCss(["Microsoft Sans Serif"])).toMatch(/, sans-serif$/);
    expect(fontFamilyCss(["Fira Code"])).toMatch(/, monospace$/);
  });
});

describe("paragraph spacing", () => {
  const spaced = (props: Record<string, unknown>, text: string) => h(Paragraph, { spacing: { before: 120, after: 240 }, ...props }, text);

  test("a contextual-spacing paragraph drops its space next to a paragraph of the same style only", () => {
    const blocks = body(
      doc(
        {},
        spaced({ style: "ListParagraph", contextualSpacing: true }, "one"),
        spaced({ style: "ListParagraph", contextualSpacing: true }, "two"),
        spaced({}, "after")
      )
    );
    expect(paragraphAt(blocks, 0).format).toMatchObject({ spaceBeforePt: 6, spaceAfterPt: 0 });
    expect(paragraphAt(blocks, 1).format).toMatchObject({ spaceBeforePt: 0, spaceAfterPt: 12 });
    expect(paragraphAt(blocks, 2).format).toMatchObject({ spaceBeforePt: 6, spaceAfterPt: 12 });
  });
});

describe("raw XML the reader kept", () => {
  const raw = (xml: string) => h(RawXml, { xml });
  const r = (inner: string) => `<w:r>${inner}</w:r>`;

  test("a content control's paragraphs are drawn with their own properties", () => {
    const sdt =
      '<w:sdt><w:sdtPr><w:alias w:val="Client"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + r("<w:rPr><w:b/></w:rPr><w:t>John Citizen</w:t>") + "</w:p>" +
      "<w:p>" + r("<w:t>Contoso</w:t>") + "</w:p>" +
      "</w:sdtContent></w:sdt>";
    const blocks = body(doc({}, raw(sdt)));
    expect(blocks.map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind))).toEqual(["John Citizen", "Contoso"]);
    expect(paragraphAt(blocks, 0).format.align).toBe("center");
    expect(textAt(paragraphAt(blocks, 0).inlines, 0).run.bold).toBe(true);
  });

  test("a table of contents shows its field's result, not its instruction, across paragraphs", () => {
    const toc =
      '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>' +
      "<w:p>" + r('<w:fldChar w:fldCharType="begin"/>') + r('<w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText>') +
      r('<w:fldChar w:fldCharType="separate"/>') +
      '<w:hyperlink w:anchor="_Toc1">' + r("<w:t>Introduction</w:t>") + r("<w:tab/>") +
      r('<w:fldChar w:fldCharType="begin"/>') + r("<w:instrText> PAGEREF _Toc1 \\h </w:instrText>") +
      r('<w:fldChar w:fldCharType="separate"/>') + r("<w:t>6</w:t>") + r('<w:fldChar w:fldCharType="end"/>') +
      "</w:hyperlink></w:p>" +
      "<w:p>" + r('<w:fldChar w:fldCharType="end"/>') + "</w:p>" +
      "</w:sdtContent></w:sdt>";
    const [entry] = body(doc({}, raw(toc))).map((_, i, all) => paragraphAt(all, i));
    const link = entry.inlines[0];
    expect(link).toMatchObject({ kind: "link", href: "#_Toc1" });
    const shown = link.kind === "link" ? link.inlines.map((i) => (i.kind === "text" ? i.text : i.kind)) : [];
    expect(shown).toEqual(["Introduction", "tab", "6"]);
  });

  test("a smart tag's runs are drawn in their paragraph", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, null, "Call ", raw(`<w:smartTag w:element="place">${r("<w:t>Seattle</w:t>")}</w:smartTag>`)))), 0);
    expect(textOf(p)).toBe("Call Seattle");
  });

  const pageTexts = (pages: readonly ResolvedPage[]) => pages.map((page) => body([page]).map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind)));
  const inSection = (props: Record<string, unknown> | null, ...children: ReactNode[]) =>
    resolveDocument(renderToTree(h(Document, null, h(Section, props, ...children))));

  test("a page break inside a run breaks the page where it falls", () => {
    const pages = inSection(null, raw(`<w:p>${r('<w:t>A</w:t><w:br w:type="page"/><w:t>B</w:t>')}</w:p>`));
    expect(pageTexts(pages)).toEqual([["A"], ["B"]]);
  });

  test("a column break inside a run moves to the next column, not to a new line", () => {
    const pages = inSection({ properties: { column: { count: 2 } } }, raw(`<w:p>${r('<w:t>A</w:t><w:br w:type="column"/><w:t>B</w:t>')}</w:p>`));
    expect(pageTexts(pages)).toEqual([["A", "B"]]);
    expect(pages[0].parts[0].columnStarts).toEqual([0, 1]);
  });

  test("a symbol whose char is not hex is left out instead of failing the preview", () => {
    const p = paragraphAt(body(doc({}, raw(`<w:p>${r('<w:sym w:font="Wingdings" w:char="★"/><w:t>x</w:t>')}</w:p>`))), 0);
    expect(textOf(p)).toBe("x");
  });

  test("raw XML in a run draws its text and breaks at its rendered page breaks", () => {
    const pages = inSection(null, h(Paragraph, null, h(TextRun, null, raw("<w:t>hi</w:t><w:lastRenderedPageBreak/><w:t>there</w:t>"))));
    expect(pageTexts(pages)).toEqual([["hi"], ["there"]]);
  });

  test("a symbol in raw XML in a run is drawn in its symbol font", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, null, h(TextRun, { bold: true }, raw('<w:sym w:font="Symbol" w:char="F071"/>'))))), 0);
    expect(textAt(p.inlines, 0)).toMatchObject({ text: "\uF071", run: { fontFamily: "Symbol", bold: true } });
  });

  test("raw XML that shows nothing stays a raw marker", () => {
    expect(body(doc({}, raw("<w:bookmarkStart w:id=\"1\" w:name=\"x\"/>")))[0]).toMatchObject({ kind: "raw", element: "w:bookmarkStart" });
  });
});

describe("tab stops", () => {
  const tabbed = (props: Record<string, unknown>, ...children: ReactNode[]) => paragraphAt(body(doc({}, h(Paragraph, props, ...children))), 0);
  const stops = (p: Paragraph) => p.format.tabStops.map((s) => [s.posPt, s.align, s.leader]);

  test("are relative to the left indent, merge down the cascade, and a clear stop removes one", () => {
    const styles = {
      paragraphStyles: [{ id: "Toc", name: "Toc", paragraph: { tabStops: [{ type: "right", position: 9000, leader: "dot" }, { type: "left", position: 1440 }] } }],
    };
    const p = paragraphAt(
      body(
        doc(
          { styles },
          h(Paragraph, { style: "Toc", indent: { left: 720 }, tabStops: [{ type: "clear", position: 1440 }, { type: "center", position: 4000 }] }, "x")
        )
      ),
      0
    );
    expect(stops(p)).toEqual([[200 - 36, "center", "none"], [450 - 36, "right", "dot"]]);
  });

  test("a hanging indent adds a stop at the left indent", () => {
    expect(stops(tabbed({ indent: { left: 720, hanging: 360 } }, "x"))).toEqual([[0, "left", "none"]]);
  });

  test("a left stop widens the text before it to the stop; a right stop ends the text after it there", () => {
    const p = tabbed(
      { tabStops: [{ type: "left", position: 2880 }, { type: "right", position: 9000, leader: "dot" }] },
      "Name",
      h(Tab),
      "John",
      h(Tab),
      "12"
    );
    const spans = tabLayout(p.inlines, { stops: p.format.tabStops, defaultTabPt: 36, startPt: 0 });
    expect(spans.map((s) => [s.widthPt, s.exact, s.items.map((i) => (i.kind === "gap" ? `gap:${i.leader}` : "text"))])).toEqual([
      [144, false, ["text", "gap:none"]],
      [450 - 144, true, ["text", "gap:dot", "text"]],
      [null, false, []],
    ]);
  });

  test("past the last stop, tabs stay tabs in the last span, for the browser to place at default stops", () => {
    const p = tabbed({ tabStops: [{ type: "left", position: 720 }] }, "a very long label", h(Tab), "x", h(Tab), "y");
    const spans = tabLayout(p.inlines, { stops: p.format.tabStops, defaultTabPt: 36, startPt: 0 });
    expect(spans).toHaveLength(1);
    expect(spans[0].widthPt).toBeNull();
    const kinds = spans[0].items.flatMap((i) => (i.kind === "content" ? i.inlines.map((x) => (x.kind === "text" ? x.text : x.kind)) : [i.kind]));
    expect(kinds).toEqual(["a very long label", "tab", "x", "tab", "y"]);
  });

  test("a paragraph draws its default tab stop as its tab-size", () => {
    const out = renderToStaticMarkup(h(DocxPreview, { document: renderToTree(h(Document, { defaultTabStop: 360 }, h(Section, null, h(Paragraph, null, "a", h(Tab), "b")))) }));
    expect(out).toContain("tab-size:18pt");
    expect(out).toMatch(/<span data-docx-tab=""[^>]*>\t<\/span>/);
  });

  test("tabs inside a hyperlink split it, so a table-of-contents entry's page number lands on its stop", () => {
    const p = tabbed(
      { tabStops: [{ type: "right", position: 9000, leader: "dot" }] },
      h(InternalHyperlink, { anchor: "_Toc1" }, h(TextRun, null, "Intro"), h(TextRun, null, h(Tab)), h(TextRun, null, "6"))
    );
    const [span] = tabLayout(p.inlines, { stops: p.format.tabStops, defaultTabPt: 36, startPt: 0 });
    expect(span.items.map((i) => (i.kind === "gap" ? "gap" : i.inlines.map((x) => x.kind).join()))).toEqual(["link", "gap", "link"]);
  });

  test("a tab keeps its run, so an underlined tab draws an underlined gap", () => {
    const p = tabbed({}, "Name:", h(TextRun, { underline: {} }, h(Tab)));
    expect(p.inlines[1]).toMatchObject({ kind: "tab", run: { underline: "single" } });
  });
});

describe("right to left", () => {
  test("a bidi paragraph reads left alignment and the left indent as its start, which is the right", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, { bidirectional: true, alignment: "left", indent: { left: 1440 } }, "x"))), 0);
    expect(p.format).toMatchObject({ rtl: true, align: "start" });
    expect(paragraphStyle(p.format)).toMatchObject({ direction: "rtl", marginInlineStart: "72pt", textAlign: "start" });
  });

  test("a right-to-left run takes its complex-script font, size and bold", () => {
    const run = (props: Record<string, unknown>) =>
      textAt(paragraphAt(body(doc({}, h(Paragraph, null, h(TextRun, { font: { ascii: "Arial", cs: "B Nazanin" }, size: 22, sizeComplexScript: 28, boldComplexScript: true, ...props }, "x")))), 0).inlines, 0).run;
    expect(run({ rightToLeft: true })).toMatchObject({ fontFamily: "B Nazanin", sizePt: 14, bold: true, rtl: true, otherFonts: ["Arial"] });
    expect(run({})).toMatchObject({ fontFamily: "Arial", sizePt: 11, bold: false, rtl: false, otherFonts: ["B Nazanin"] });
    expect(runStyle(run({ rightToLeft: true }))).toMatchObject({ direction: "rtl", unicodeBidi: "embed" });
    expect(runStyle(run({ rightToLeft: true })).fontFamily).toMatch(/^"B Nazanin", "Arial", /);
  });

  test("a bidiVisual table is a right-to-left table", () => {
    const t = tableAt(body(doc({}, h(Table, { visuallyRightToLeft: true }, h(TableRow, null, h(TableCell, null, h(Paragraph, null, "x")))))), 0);
    expect(t.rtl).toBe(true);
  });
});

describe("shading", () => {
  const cellShading = (shading: Record<string, unknown>) =>
    tableAt(body(doc({}, h(Table, null, h(TableRow, null, h(TableCell, { shading }, h(Paragraph, null, "x")))))), 0).rows[0].cells[0].background;

  test("a percentage pattern mixes its colour into its fill; automatic colours are black on white", () => {
    expect(cellShading({ type: "pct5", color: "auto", fill: "auto" })).toBe("F2F2F2");
    expect(cellShading({ type: "pct50", color: "FF0000", fill: "0000FF" })).toBe("800080");
  });

  test("clear shows the fill, solid the colour, and an automatic clear fill is no shading", () => {
    expect(cellShading({ type: "clear", color: "auto", fill: "FFC000" })).toBe("FFC000");
    expect(cellShading({ type: "solid", color: "00FF00", fill: "auto" })).toBe("00FF00");
    expect(cellShading({ type: "clear", color: "auto", fill: "auto" })).toBeNull();
  });
});

describe("table geometry", () => {
  const one = (tableProps: Record<string, unknown>, cellProps: Record<string, unknown> = {}) =>
    tableAt(body(doc({}, h(Table, tableProps, h(TableRow, null, h(TableCell, cellProps, h(Paragraph, null, "x")))))), 0);

  test("a pct width is a percentage, an indent and an alignment place the table", () => {
    expect(one({ width: { size: 100, type: "pct" } })).toMatchObject({ widthPct: 100, widthPt: null });
    expect(one({ indent: { size: 720, type: "dxa" }, alignment: "center", layout: "fixed" })).toMatchObject({ indentPt: 36, align: "center", fixed: true });
  });

  test("cell margins: the cell's side, else the table's, else Word's 0.075in left and right", () => {
    const t = one({ margins: { top: 40, left: 200 } }, { margins: { left: 60 } });
    expect(t.rows[0].cells[0].paddingPt).toEqual({ top: 2, right: 5.4, bottom: 0, left: 3 });
  });
});

describe("table of contents entries", () => {
  test("draw their hyperlinks in the entry's formatting, not the Hyperlink character style", () => {
    const styles = { characterStyles: [{ id: "Hyperlink", name: "Hyperlink", run: { color: "0563C1", underline: {} } }] };
    const entry = (style: string) =>
      paragraphAt(body(doc({ styles }, h(Paragraph, { style }, h(InternalHyperlink, { anchor: "_Toc1" }, h(TextRun, { style: "Hyperlink" }, "Intro"))))), 0);
    const runOfEntry = (p: Paragraph) => (p.inlines[0].kind === "link" ? textAt(p.inlines[0].inlines, 0).run : null);
    expect(runOfEntry(entry("TOC1"))).toMatchObject({ color: null, underline: null });
    expect(runOfEntry(entry("Normal"))).toMatchObject({ color: "0563C1", underline: "single" });
  });
});

describe("measured breaks", () => {
  const pagesOf = (measured: ReadonlySet<string>, ...children: ReactNode[]) =>
    resolveDocument(renderToTree(h(Document, null, h(Section, null, ...children))), measured);
  const texts = (pages: readonly ResolvedPage[]) =>
    pages.map((page) => page.parts.flatMap((part) => part.blocks).map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind)));

  test("each body block carries its key; a measured key breaks the page before that block", () => {
    const children = [h(Paragraph, null, "a"), h(Paragraph, null, "b"), h(Paragraph, null, "c")];
    expect(pagesOf(new Set(), ...children)[0].parts[0].keys).toEqual(["b0.0", "b1.0", "b2.0"]);
    expect(texts(pagesOf(new Set(["b2.0"]), ...children))).toEqual([["a", "b"], ["c"]]);
  });

  test("a measured row key breaks a table there and repeats its header rows; the piece's key names its first row", () => {
    const row = (text: string, tableHeader?: boolean) => h(TableRow, { tableHeader }, h(TableCell, null, h(Paragraph, null, text)));
    const pages = pagesOf(new Set(["r0:2"]), h(Table, null, row("head", true), row("a"), row("b")));
    const rowsOf = (page: ResolvedPage) =>
      page.parts[0].blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => textOf(paragraphAt(r.cells[0].blocks, 0))) : []));
    expect(pages.map(rowsOf)).toEqual([["head", "a"], ["head", "b"]]);
    expect(pages.map((page) => page.parts[0].keys)).toEqual([["t0:0:0"], ["t0:2:1"]]);
  });

  test("a page that ends at Word's rendered break is marked laid out, for measuring to leave be", () => {
    const pages = pagesOf(new Set(), h(Paragraph, null, "a"), h(Paragraph, null, h(TextRun, null, h(RawXml, { xml: "<w:lastRenderedPageBreak/>" }), "b")), h(Paragraph, null, "c", h(PageBreak), "d"));
    expect(pages.map((page) => page.laidOut)).toEqual([true, false, false]);
  });
});

describe("page-number fields in raw XML", () => {
  test("show the page's number, not the field's cached result", () => {
    const r = (inner: string) => `<w:r>${inner}</w:r>`;
    const sdt =
      '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/></w:docPartObj></w:sdtPr><w:sdtContent><w:p>' +
      r('<w:fldChar w:fldCharType="begin"/>') + r('<w:instrText xml:space="preserve"> PAGE   \\* MERGEFORMAT </w:instrText>') +
      r('<w:fldChar w:fldCharType="separate"/>') + r("<w:t>4</w:t>") + r('<w:fldChar w:fldCharType="end"/>') +
      '</w:p><w:p><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p></w:sdtContent></w:sdt>';
    const [page, total] = body(doc({}, h(RawXml, { xml: sdt }))).map((_, i, all) => paragraphAt(all, i).inlines);
    expect(page).toEqual([expect.objectContaining({ kind: "field", field: "page" })]);
    expect(total).toEqual([expect.objectContaining({ kind: "field", field: "numPages" })]);
  });
});

describe("page-number fields in raw XML, read as the reader reads them", () => {
  const r = (inner: string) => `<w:r>${inner}</w:r>`;
  const complex = (instruction: string, cached: string) =>
    r('<w:fldChar w:fldCharType="begin"/>') + r(`<w:instrText xml:space="preserve">${instruction}</w:instrText>`) +
    r('<w:fldChar w:fldCharType="separate"/>') + r(`<w:t>${cached}</w:t>`) + r('<w:fldChar w:fldCharType="end"/>');
  const inlinesOf = (xml: string) => body(doc({}, h(RawXml, { xml }))).map((_, i, all) => paragraphAt(all, i).inlines);

  test("a SECTION field shows the section's number", () => {
    const [complexField, simple] = inlinesOf(`<w:p>${complex(" SECTION ", "7")}</w:p><w:p><w:fldSimple w:instr=" SECTION "><w:r><w:t>7</w:t></w:r></w:fldSimple></w:p>`);
    expect(complexField).toEqual([expect.objectContaining({ kind: "field", field: "section" })]);
    expect(simple).toEqual([expect.objectContaining({ kind: "field", field: "section" })]);
  });

  test("a PAGE field with a switch other than MERGEFORMAT shows its cached result", () => {
    const [complexField, simple] = inlinesOf(`<w:p>${complex(" PAGE \\* roman ", "iv")}</w:p><w:p><w:fldSimple w:instr=" PAGE \\* roman "><w:r><w:t>iv</w:t></w:r></w:fldSimple></w:p>`);
    expect(complexField).toEqual([expect.objectContaining({ kind: "text", text: "iv" })]);
    expect(simple).toEqual([expect.objectContaining({ kind: "text", text: "iv" })]);
  });
});

describe("floating pictures", () => {
  const floatOf = (floating: Record<string, unknown>) => {
    const p = paragraphAt(body(doc({}, h(Paragraph, null, h(ImageRun, { type: "png", data: PNG_1PX, transformation: { width: 10, height: 10 }, floating })))), 0);
    const image = p.inlines[0];
    if (image.kind !== "image") throw new Error(`inline is a ${image.kind}`);
    return image.float;
  };

  test("positions and distances are in points, from the page, the margin or the paragraph", () => {
    const float = floatOf({
      horizontalPosition: { relative: "page", offset: 914400 },
      verticalPosition: { relative: "paragraph", offset: 127000 },
      wrap: { type: 1 },
      margins: { left: 12700, right: 25400 },
    });
    expect(float).toMatchObject({
      wrap: "square",
      behind: false,
      horizontal: { from: "page", align: null, offsetPt: 72 },
      vertical: { from: "paragraph", offsetPt: 10 },
      distancePt: { left: 1, right: 2 },
    });
  });

  test("tight wraps as square; no wrap given is none; an alignment replaces the offset", () => {
    expect(floatOf({ horizontalPosition: { relative: "margin", align: "right" }, verticalPosition: { relative: "page", align: "top" }, wrap: { type: 2 } })).toMatchObject({
      wrap: "square",
      horizontal: { from: "margin", align: "right" },
      vertical: { from: "page", align: "top" },
    });
    expect(floatOf({ horizontalPosition: { offset: 0 }, verticalPosition: { offset: 0 } })?.wrap).toBe("none");
  });
});

describe("paragraph border groups", () => {
  test("consecutive paragraphs with the same borders are one box: top border on the first, bottom on the last", () => {
    const box = { top: { style: "single", size: 8, color: "000000" }, bottom: { style: "single", size: 8, color: "000000" }, left: { style: "single", size: 8, color: "000000" } };
    const blocks = body(doc({}, h(Paragraph, { border: box }, "a"), h(Paragraph, { border: box }, "b"), h(Paragraph, { border: box }, "c"), h(Paragraph, null, "d")));
    const sides = (i: number) => Object.keys(paragraphAt(blocks, i).format.borders).sort();
    expect([sides(0), sides(1), sides(2), sides(3)]).toEqual([["left", "top"], ["left"], ["bottom", "left"], []]);
  });

  test("space before and after is padding, so shading covers it and neighbours do not collapse it", () => {
    const p = paragraphAt(body(doc({}, h(Paragraph, { spacing: { before: 120, after: 240 }, shading: { type: "clear", fill: "FFFF00" } }, "x"))), 0);
    expect(paragraphStyle(p.format)).toMatchObject({ paddingTop: "6pt", paddingBottom: "12pt", backgroundColor: "#FFFF00" });
  });
});

describe("text boxes", () => {
  const box = (style: Record<string, unknown>) => {
    const b = body(doc({}, h(Textbox, { style }, h(Paragraph, null, "x"))))[0];
    if (b.kind !== "textbox") throw new Error(`block is a ${b.kind}`);
    return b;
  };

  test("an absolute VML text box is placed from its frame; its lengths may be px or have units", () => {
    expect(
      box({ position: "absolute", marginLeft: "1in", marginTop: 20, width: "2in", height: "40pt", positionHorizontalRelative: "page", positionVerticalRelative: "text" })
    ).toMatchObject({ widthPt: 144, heightPt: 40, float: { wrap: "none", horizontal: { from: "page", offsetPt: 72 }, vertical: { from: "paragraph", offsetPt: 15 } } });
  });

  test("a text box without a position stays in the flow", () => {
    expect(box({ width: "100pt" })).toMatchObject({ widthPt: 100, float: null });
  });
});

describe("a table row Word broke across pages", () => {
  test("is split at its cells' rendered breaks, one row per page, each cell up to its next break", () => {
    const RENDERED = h(RawXml, { xml: "<w:lastRenderedPageBreak/>" });
    const pages = resolveDocument(
      renderToTree(
        h(
          Document,
          null,
          h(
            Section,
            null,
            h(
              Table,
              null,
              h(
                TableRow,
                null,
                h(TableCell, null, h(Paragraph, null, "a1"), h(Paragraph, null, h(TextRun, null, RENDERED, "a2"))),
                h(TableCell, null, h(Paragraph, null, "b1"), h(Paragraph, null, h(TextRun, null, RENDERED, "b2")), h(Paragraph, null, h(TextRun, null, RENDERED, "b3")))
              )
            )
          )
        )
      )
    );
    const cellsOf = (page: ResolvedPage) =>
      page.parts[0].blocks.flatMap((b) => (b.kind === "table" ? b.rows.flatMap((r) => r.cells.map((c) => c.blocks.map((x) => (x.kind === "paragraph" ? textOf(x) : x.kind)).join())) : []));
    expect(pages.map(cellsOf)).toEqual([["a1", "b1"], ["a2", "b2"], ["", "b3"]]);
  });
});

describe("review fixes: pagination edge cases", () => {
  const RENDERED = h(RawXml, { xml: "<w:lastRenderedPageBreak/>" });
  const pagesOf = (measured: ReadonlySet<string>, ...sections: ReactNode[]) => resolveDocument(renderToTree(h(Document, null, ...sections)), measured);
  const texts = (pages: readonly ResolvedPage[]) =>
    pages.map((page) => page.parts.flatMap((part) => part.blocks).map((b) => (b.kind === "paragraph" ? textOf(b) : b.kind)));
  const rowTexts = (page: ResolvedPage) =>
    page.parts.flatMap((part) => part.blocks).flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r.cells.map((c) => c.blocks.map((x) => (x.kind === "paragraph" ? textOf(x) : x.kind)).join()).join("|")) : []));
  const c = (text: ReactNode, props: Record<string, unknown> = {}) => h(TableCell, props, h(Paragraph, null, text));

  test("a break inside a vertically merged region moves the whole region, so no cell shifts", () => {
    const pages = pagesOf(
      new Set(["r0:2"]),
      h(
        Section,
        null,
        h(
          Table,
          { columnWidths: [2000, 4000] },
          h(TableRow, null, c("top"), c("x")),
          h(TableRow, null, c("M", { verticalMerge: "restart" }), c("a")),
          h(TableRow, null, c("", { verticalMerge: "continue" }), c("b"))
        )
      )
    );
    expect(pages.map(rowTexts)).toEqual([["top|x"], ["M|a", "b"]]);
  });

  test("a rendered break in a table in columns moves to the next column, not the next page", () => {
    const pages = pagesOf(
      new Set(),
      h(Section, { properties: { column: { count: 2 } } }, h(Paragraph, null, "intro"), h(Table, null, h(TableRow, null, c("a")), h(TableRow, null, c(h(TextRun, null, RENDERED, "b")))))
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].parts[0].columnStarts).toEqual([0, 2]);
  });

  test("a floating text box goes on the page of the paragraph it is anchored in", () => {
    const pages = pagesOf(
      new Set(),
      h(
        Section,
        null,
        h(Paragraph, null, "page one"),
        h(Textbox, { style: { position: "absolute", width: "100pt" } }, h(Paragraph, null, "box")),
        h(Paragraph, null, h(TextRun, null, RENDERED, "page two"))
      )
    );
    expect(texts(pages)).toEqual([["page one"], ["textbox", "page two"]]);
  });

  test("a cell paragraph that starts on a new page keeps its first-line indent and space before", () => {
    const pages = pagesOf(
      new Set(),
      h(
        Section,
        null,
        h(
          Table,
          null,
          h(
            TableRow,
            null,
            h(TableCell, null, h(Paragraph, null, "one"), h(Paragraph, { indent: { firstLine: 360 }, spacing: { before: 120 } }, h(TextRun, null, RENDERED, "two")))
          )
        )
      )
    );
    const second = pages[1].parts[0].blocks[0];
    const p = second.kind === "table" ? paragraphAt(second.rows[0].cells[0].blocks, 0) : null;
    expect(p?.format).toMatchObject({ firstLinePt: 18, spaceBeforePt: 6 });
  });

  test("a cell paragraph broken across pages keeps its space after on its last piece only", () => {
    const pages = pagesOf(
      new Set(),
      h(Section, null, h(Table, null, h(TableRow, null, h(TableCell, null, h(Paragraph, { spacing: { after: 240 } }, h(TextRun, null, "one", RENDERED, "two"))))))
    );
    const cellParagraph = (page: ResolvedPage) => {
      const table = page.parts[0].blocks[0];
      return table.kind === "table" ? paragraphAt(table.rows[0].cells[0].blocks, 0) : null;
    };
    expect(pages.map(rowTexts)).toEqual([["one"], ["two"]]);
    expect(pages.map((page) => cellParagraph(page)?.format.spaceAfterPt)).toEqual([0, 12]);
  });

  test("a cell paragraph holding only a rendered break keeps its empty line, on the page after the break", () => {
    const pages = pagesOf(
      new Set(),
      h(
        Section,
        null,
        h(Table, null, h(TableRow, null, h(TableCell, null, h(Paragraph, null, "a"), h(Paragraph, null, h(TextRun, null, RENDERED)), h(Paragraph, null, "b"))))
      )
    );
    expect(pages.map(rowTexts)).toEqual([["a"], [",b"]]);
  });

  test("a measured break before a table's first body row is ignored rather than leave a page of header rows", () => {
    const pages = pagesOf(new Set(["r0:1"]), h(Section, null, h(Table, null, h(TableRow, { tableHeader: true }, c("H")), h(TableRow, null, c("tall")), h(TableRow, null, c("next")))));
    expect(pages.map(rowTexts)).toEqual([["H", "tall", "next"]]);
  });

  test("contextual spacing and border groups look past a placed text box", () => {
    const tight = { style: "ListParagraph", contextualSpacing: true, spacing: { before: 120, after: 120 } };
    const blocks = body(
      doc({}, h(Paragraph, tight, "one"), h(Textbox, { style: { position: "absolute" } }, h(Paragraph, null, "box")), h(Paragraph, tight, "two"))
    );
    expect(paragraphAt(blocks, 0).format.spaceAfterPt).toBe(0);
    expect(paragraphAt(blocks, 2).format.spaceBeforePt).toBe(0);
  });
});
