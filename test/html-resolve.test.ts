import { HeadingLevel } from "docx";
import { createElement as h, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import {
  Document,
  Footnote,
  ImageRun,
  Paragraph,
  Section,
  Table,
  TableCell,
  TableRow,
  TextRun,
  renderToBuffer,
  renderToTree,
} from "../src/index";
import { borderCss, paragraphStyle, runStyle } from "../src/html/css";
import { DOCX_DEFAULT_STYLES } from "../src/html/docx-default-styles.generated";
import { resolveDocument, type ResolvedBlock, type ResolvedInline, type ResolvedSection } from "../src/html/resolve";
import { readDocx } from "../src/read/index";
import type { DocumentNode } from "../src/schema/elements";
import { WORD_SHAPED } from "./fixtures/word-shaped";
import { PNG_1PX } from "./support/cases";

type Paragraph = Extract<ResolvedBlock, { kind: "paragraph" }>;
type Table = Extract<ResolvedBlock, { kind: "table" }>;
type Text = Extract<ResolvedInline, { kind: "text" }>;

const doc = (props: Record<string, unknown>, ...children: ReactNode[]) =>
  resolveDocument(renderToTree(h(Document, props, h(Section, null, ...children))));

const body = (sections: readonly ResolvedSection[]): readonly ResolvedBlock[] => sections[0].body;

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
    expect(paragraphStyle(paragraphAt(blocks, 0).format).lineHeight).toBe(1.15);
    expect(paragraphStyle(paragraphAt(blocks, 1).format).lineHeight).toBe("12pt");
  });

  test("hanging 360 is a first line of -18pt", () => {
    expect(paragraphAt(blocks, 2).format).toMatchObject({ indentLeftPt: 36, firstLinePt: -18 });
    expect(paragraphStyle(paragraphAt(blocks, 2).format)).toMatchObject({ marginLeft: "36pt", textIndent: "-18pt" });
  });

  test("a size 4 border is 0.5pt, and an auto colour draws black", () => {
    const bottom = paragraphAt(blocks, 3).format.borders.bottom;
    expect(bottom).toEqual({ style: "solid", widthPt: 0.5, color: "000000" });
    expect(bottom === undefined ? null : borderCss(bottom)).toBe("0.5pt solid #000000");
  });

  test("runs become pt sizes, quoted font names and hex colours", () => {
    const run = textAt(
      paragraphAt(body(doc({}, h(Paragraph, null, h(TextRun, { font: "Open Sans", size: 22, color: "auto", bold: true }, "x")))), 0).inlines,
      0
    ).run;
    expect(run.color).toBeNull();
    expect(runStyle(run)).toMatchObject({ fontFamily: '"Open Sans"', fontSize: "11pt", fontWeight: "bold" });
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
    expect(image).toMatchObject({ widthPx: 10, heightPx: 20, floating: false });
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
  test("are numbered 1..n across the document and collected per section", () => {
    const note = (text: string) => h(Paragraph, null, text, h(Footnote, null, `note ${text}`));
    const sections = resolveDocument(
      renderToTree(h(Document, null, h(Section, null, note("a"), note("b")), h(Section, null, note("c"))))
    );
    const refs = sections.flatMap((s) => s.body.flatMap((b) => (b.kind === "paragraph" ? b.inlines : [])).filter((i) => i.kind === "footnoteRef"));
    expect(refs.map((r) => (r.kind === "footnoteRef" ? r.n : 0))).toEqual([1, 2, 3]);
    expect(sections.map((s) => s.footnotes.map((f) => f.n))).toEqual([[1, 2], [3]]);
    expect(textOf(paragraphAt(sections[1].footnotes[0].blocks, 0))).toBe("note c");
    expect(refs[0]).toMatchObject({ run: { verticalAlign: "super" } });
  });
});
