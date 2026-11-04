import { PageNumber } from "docx";
import { createElement as h } from "react";
import { describe, expect, test } from "vitest";
import { DeletedTextRun, Document, Paragraph, Section, TextRun, renderToBuffer, renderToTree } from "../src/index";
import { formatNumber, markerText, type Counters } from "../src/ooxml/markers";
import { readDocx, type Diagnostic } from "../src/read/index";
import { CASES } from "./support/cases";
import { docx, part, type FixtureParts } from "./support/docx-fixture";

type TreeNode = { readonly type: string; readonly props: Record<string, unknown>; readonly children: readonly (TreeNode | string)[] };

const FOOTER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer";
const HEADER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";
const DATE = "2026-01-01T00:00:00Z";

const rel = (id: string, type: string, target: string): string => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
const run = (text: string): string => `<w:r><w:t>${text}</w:t></w:r>`;
const lvl = (ilvl: number, format: string, text: string, inside = ""): string =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/>${inside}</w:lvl>`;
const item = (numId: string, ilvl: number, text: string, pStyle?: string): string =>
  `<w:p><w:pPr>${pStyle === undefined ? "" : `<w:pStyle w:val="${pStyle}"/>`}<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;

const tree = (value: unknown): TreeNode => value as TreeNode;
const read = (parts: FixtureParts) => readDocx(docx(parts));
const documentOf = (parts: FixtureParts) => tree(read(parts).document);
const blocksOf = (parts: FixtureParts) => tree(documentOf(parts).children[0]).children as TreeNode[];

const node = (type: string, props: Record<string, unknown> = {}, children: readonly (TreeNode | string)[] = []): TreeNode => ({
  type,
  props,
  children,
});
const text = (t: string, props: Record<string, unknown> = {}) => node("TextRun", props, [t]);
const paragraph = (t: string) => node("Paragraph", {}, [text(t)]);

function findAll(root: TreeNode, type: string): TreeNode[] {
  const own = root.type === type ? [root] : [];
  return [...own, ...root.children.flatMap((child) => (typeof child === "string" ? [] : findAll(child, type)))];
}

const located = (diagnostics: readonly Diagnostic[], kind: string, element: string) =>
  diagnostics.filter((d) => d.kind === kind && d.element === element);

const ignoredCount = (diagnostics: readonly Diagnostic[], element: string): number => {
  const found = diagnostics.find((d) => d.kind === "ignored" && d.element === element);
  return found?.kind === "ignored" ? found.count : 0;
};

const BULLETS = `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0, "bullet", "•")}</w:abstractNum>`;
const NUMBERED = `<w:abstractNum w:abstractNumId="7"><w:nsid w:val="1A2B3C4D"/>${lvl(0, "decimal", "%1.")}${lvl(1, "lowerLetter", "%2)")}</w:abstractNum>`;
const NUMBERING =
  BULLETS +
  NUMBERED +
  '<w:num w:numId="1"><w:abstractNumId w:val="7"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="3"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="7"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>' +
  '<w:num w:numId="4"><w:abstractNumId w:val="7"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="3"/></w:lvlOverride></w:num>';

const numberingOf = (p: TreeNode) => p.props.numbering;

describe("lists", () => {
  test("abstractNums get list-N references in order of first use, and config lists them in that order", () => {
    const document = documentOf({ body: item("1", 0, "one") + item("2", 0, "dot"), numbering: NUMBERING });
    const [one, dot] = tree(document.children[0]).children as TreeNode[];
    expect(numberingOf(one)).toEqual({ reference: "list-1", level: 0, instance: 0, custom: true });
    expect(numberingOf(dot)).toEqual({ reference: "list-2", level: 0, instance: 0, custom: true });
    expect(document.props.numbering).toEqual({
      config: [
        {
          reference: "list-1",
          levels: [
            { level: 0, start: 1, format: "decimal", text: "%1." },
            { level: 1, start: 1, format: "lowerLetter", text: "%2)" },
          ],
        },
        { reference: "list-2", levels: [{ level: 0, start: 1, format: "bullet", text: "•" }] },
      ],
    });
  });

  test("two w:nums on one abstractNum are instances 0 and 1; docx.js's own level-0 start override is accepted", () => {
    const { document, diagnostics } = read({ body: item("1", 0, "a") + item("3", 0, "b"), numbering: NUMBERING });
    const [a, b] = tree(tree(document).children[0]).children as TreeNode[];
    expect(numberingOf(a)).toMatchObject({ reference: "list-1", instance: 0 });
    expect(numberingOf(b)).toMatchObject({ reference: "list-1", instance: 1 });
    expect(located(diagnostics, "dropped", "w:lvlOverride")).toEqual([]);
  });

  test("w:ilvl gives the level", () => {
    const [, nested] = blocksOf({ body: item("1", 0, "a") + item("1", 1, "b"), numbering: NUMBERING });
    expect(numberingOf(nested)).toEqual({ reference: "list-1", level: 1, instance: 0, custom: true });
  });

  test("a paragraph with a pStyle keeps the style and gets no custom", () => {
    const [p] = blocksOf({ body: item("1", 0, "a", "ListParagraph"), numbering: NUMBERING });
    expect(p.props).toEqual({ style: "ListParagraph", numbering: { reference: "list-1", level: 0, instance: 0 } });
  });

  test("a w:lvlOverride on level 2 is dropped and the paragraph keeps the list", () => {
    const { document, diagnostics } = read({ body: item("4", 0, "a"), numbering: NUMBERING });
    expect(numberingOf(tree(tree(document).children[0]).children[0] as TreeNode)).toMatchObject({ reference: "list-1" });
    expect(located(diagnostics, "dropped", "w:lvlOverride")).toHaveLength(1);
  });

  test('numId "0" is numbering: false, and an unknown numId is dropped', () => {
    const { document, diagnostics } = read({ body: item("0", 0, "off") + item("99", 0, "unknown"), numbering: NUMBERING });
    const [off, unknown] = tree(tree(document).children[0]).children as TreeNode[];
    expect(off.props).toEqual({ numbering: false });
    expect(unknown.props).toEqual({});
    expect(located(diagnostics, "dropped", "w:numPr")).toEqual([
      expect.objectContaining({ at: [0, 1], detail: "numId 99 is not defined in numbering.xml" }),
    ]);
  });

  test("docx.js's unused default-bullet-numbering is counted ignored", async () => {
    const element = h(Document, null, h(Section, null, h(Paragraph, null, h(TextRun, null, "plain"))));
    const { document, diagnostics } = readDocx(await renderToBuffer(element));
    expect(ignoredCount(diagnostics, "w:abstractNum")).toBe(1);
    expect(tree(document).props.numbering).toBeUndefined();
  });

  test("a paragraph style's numPr becomes paragraph.numbering after the body's lists, and survives a write", async () => {
    const styles =
      '<w:style w:type="paragraph" w:styleId="Bulleted"><w:name w:val="Bulleted"/>' +
      '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>';
    const first = readDocx(docx({ body: item("1", 0, "a"), numbering: NUMBERING, styles }));
    const style = { id: "Bulleted", name: "Bulleted", paragraph: { numbering: { reference: "list-2", level: 0, instance: 0, custom: true } } };
    expect(tree(first.document).props.styles).toEqual({ paragraphStyles: [style] });
    const second = readDocx(await renderToBuffer(first.document));
    expect(tree(second.document).props.styles).toMatchObject({ paragraphStyles: [style] });
    const references = (document: unknown) => (tree(document).props.numbering as { config: { reference: string }[] }).config.map((c) => c.reference);
    expect(references(second.document)).toEqual(["list-1", "list-2"]);
  });
});

describe("list markers outside the body", () => {
  const numbering =
    `<w:abstractNum w:abstractNumId="0">${lvl(0, "decimal", "%1.", '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>')}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  const withHeader = (inside: string): FixtureParts => ({
    body: `<w:p>${run("body")}</w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/></w:sectPr>`,
    rels: rel("rIdH1", HEADER, "header1.xml"),
    parts: { "word/header1.xml": part("w:hdr", inside) },
    numbering,
  });

  test("a numbered header paragraph starts with its marker and a Tab, takes the level's indent, and loses numbering", () => {
    const { document, diagnostics } = read(withHeader(item("1", 0, "Intro") + item("1", 0, "Next")));
    const header = tree(tree(document).children[0]).children[0] as TreeNode;
    const indent = { left: 720, hanging: 360 };
    expect(header.children).toEqual([
      node("Paragraph", { indent }, [node("TextRun", {}, ["1.", node("Tab")]), text("Intro")]),
      node("Paragraph", { indent }, [node("TextRun", {}, ["2.", node("Tab")]), text("Next")]),
    ]);
    expect(located(diagnostics, "resolved", "w:numPr")).toEqual([
      expect.objectContaining({ part: "word/header1.xml", at: [0, 0, 0] }),
      expect.objectContaining({ part: "word/header1.xml", at: [0, 0, 1] }),
    ]);
    expect(tree(document).props.numbering).toBeUndefined();
  });

  test("a numbered paragraph inside a footnote also gets its marker as text, since docx.js writes no numbering there", () => {
    const footnotes = `<w:footnote w:id="1">${item("1", 0, "listed")}</w:footnote>`;
    const [p] = blocksOf({ body: `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`, footnotes, numbering });
    const footnote = p.children[0] as TreeNode;
    expect((footnote.children[0] as TreeNode).children[0]).toEqual(node("TextRun", {}, ["1.", node("Tab")]));
    expect(findAll(footnote, "Paragraph").every((q) => q.props.numbering === undefined)).toBe(true);
  });
});

describe("markers", () => {
  const levels = [
    { level: 0, format: "decimal" as const, text: "%1." },
    { level: 1, format: "decimal" as const, text: "%1.%2." },
  ];

  test("%1.%2. at level 1 after two level-0 items and one level-1 item is 2.1.", () => {
    const counters: Counters = new Map();
    const shown = [0, 0, 1].map((level) => markerText(levels, counters, "list-1:0", level));
    expect(shown).toEqual(["1.", "2.", "2.1."]);
  });

  test("advancing a level restarts the levels below it", () => {
    const counters: Counters = new Map();
    const shown = [0, 1, 1, 0, 1].map((level) => markerText(levels, counters, "list-1:0", level));
    expect(shown).toEqual(["1.", "1.1.", "1.2.", "2.", "2.1."]);
  });

  test("a bullet level shows its lvlText as it is, and counting starts at the level's start", () => {
    const counters: Counters = new Map();
    expect(markerText([{ level: 0, format: "bullet", text: "•" }], counters, "b", 0)).toBe("•");
    expect(markerText([{ level: 0, format: "upperRoman", text: "%1)", start: 4 }], counters, "r", 0)).toBe("IV)");
  });

  test.each<[string, number, string]>([
    ["decimal", 1, "1"],
    ["decimal", 2, "2"],
    ["decimalZero", 1, "01"],
    ["decimalZero", 2, "02"],
    ["lowerLetter", 1, "a"],
    ["lowerLetter", 2, "b"],
    ["lowerLetter", 27, "aa"],
    ["upperLetter", 1, "A"],
    ["upperLetter", 2, "B"],
    ["upperLetter", 27, "AA"],
    ["lowerRoman", 1, "i"],
    ["lowerRoman", 2, "ii"],
    ["lowerRoman", 4, "iv"],
    ["upperRoman", 1, "I"],
    ["upperRoman", 2, "II"],
    ["upperRoman", 4, "IV"],
    ["none", 1, ""],
    ["ordinal", 1, "1st"],
    ["ordinal", 2, "2nd"],
    ["chineseCounting", 3, "3"],
  ])("formatNumber(%s) of %i is %j", (format, n, expected) => {
    expect(formatNumber(n, format)).toBe(expected);
  });
});

const SEPARATORS =
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
const footnote = (id: string, inside: string): string => `<w:footnote w:id="${id}">${inside}</w:footnote>`;
const NOTE_MARK = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>';
const reference = (id: string): string => `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;

describe("footnotes", () => {
  const NOTE = SEPARATORS + footnote("1", `<w:p>${NOTE_MARK}${run("note")}</w:p>`);

  test("a reference mid-run splits the run around a Footnote, and the w:footnoteRef run is gone", () => {
    const { document, diagnostics } = read({
      body: '<w:p><w:r><w:t>a</w:t><w:footnoteReference w:id="1"/><w:t>b</w:t></w:r></w:p>',
      footnotes: NOTE,
    });
    expect(tree(tree(document).children[0]).children[0]).toEqual(
      node("Paragraph", {}, [text("a"), node("Footnote", {}, [paragraph("note")]), text("b")])
    );
    expect(ignoredCount(diagnostics, "w:footnoteRef")).toBe(1);
    expect(ignoredCount(diagnostics, "w:footnote")).toBe(2);
  });

  test("two references to one footnote give its content twice, with a resolved diagnostic", () => {
    const { document, diagnostics } = read({ body: `<w:p>${reference("1")}${reference("1")}</w:p>`, footnotes: NOTE });
    const note = node("Footnote", {}, [paragraph("note")]);
    expect(tree(tree(document).children[0]).children[0]).toEqual(node("Paragraph", {}, [note, note]));
    expect(located(diagnostics, "resolved", "w:footnoteReference")).toEqual([
      expect.objectContaining({ detail: "footnote 1 referenced twice; content duplicated" }),
    ]);
  });

  test("a reference in a footer is dropped", () => {
    const { diagnostics } = read({
      body: `<w:p>${run("body")}</w:p><w:sectPr><w:footerReference w:type="default" r:id="rIdF1"/></w:sectPr>`,
      rels: rel("rIdF1", FOOTER, "footer1.xml"),
      parts: { "word/footer1.xml": part("w:ftr", `<w:p>${reference("1")}</w:p>`) },
      footnotes: NOTE,
    });
    expect(located(diagnostics, "dropped", "w:footnoteReference")).toEqual([
      expect.objectContaining({ part: "word/footer1.xml" }),
    ]);
    expect(located(diagnostics, "dropped", "w:footnote")).toEqual([
      expect.objectContaining({ detail: "footnote 1 is never referenced, and docx.js writes only referenced footnotes" }),
    ]);
  });

  test("a footnote holding only a table gets an empty Paragraph first, and renderToBuffer accepts it", async () => {
    const table = `<w:tbl><w:tr><w:tc><w:p>${run("cell")}</w:p></w:tc></w:tr></w:tbl>`;
    const { document, diagnostics } = read({ body: `<w:p>${reference("1")}</w:p>`, footnotes: SEPARATORS + footnote("1", table) });
    const read1 = findAll(tree(document), "Footnote")[0];
    expect(read1.children.map((child) => (child as TreeNode).type)).toEqual(["Paragraph", "Table"]);
    expect(read1.children[0]).toEqual(node("Paragraph"));
    expect(located(diagnostics, "resolved", "w:footnote")).toEqual([
      expect.objectContaining({ part: "word/footnotes.xml", detail: "footnote 1 did not start with a paragraph" }),
    ]);
    await expect(renderToBuffer(document)).resolves.toBeInstanceOf(Buffer);
  });

  test("a block w:sdt in a footnote is unwrapped: its paragraphs kept, the w:sdt dropped, no RawXml", () => {
    const sdt = `<w:sdt><w:sdtPr><w:alias w:val="Box"/></w:sdtPr><w:sdtContent><w:p>${run("kept")}</w:p></w:sdtContent></w:sdt>`;
    const { document, diagnostics } = read({
      body: `<w:p>${reference("1")}</w:p>`,
      footnotes: SEPARATORS + footnote("1", `<w:p>${NOTE_MARK}${run("first")}</w:p>${sdt}`),
    });
    expect(findAll(tree(document), "Footnote")).toEqual([node("Footnote", {}, [paragraph("first"), paragraph("kept")])]);
    expect(located(diagnostics, "dropped", "w:sdt")).toHaveLength(1);
    expect(findAll(tree(document), "RawXml")).toEqual([]);
  });
});

describe("comments", () => {
  const annotated = (t: string): string => `<w:p><w:r><w:annotationRef/></w:r>${run(t)}</w:p>`;
  const COMMENTS =
    `<w:comment w:id="2" w:author="B" w:date="2026-02-01T00:00:00Z" w:initials="BB">${annotated("second")}</w:comment>` +
    `<w:comment w:id="5" w:author="A" w:date="${DATE}">${annotated("first")}</w:comment>` +
    `<w:comment w:id="8" w:author="C">${annotated("undated")}</w:comment>`;
  const marks = (id: string, t: string): string =>
    `<w:commentRangeStart w:id="${id}"/>${run(t)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

  test("comments get ids by body order, carry them on their marks, and follow the Sections", () => {
    const { document, diagnostics } = read({
      body: `<w:p>${marks("5", "x")}${marks("2", "y")}<w:commentRangeStart w:id="9"/></w:p>`,
      comments: COMMENTS,
    });
    const [section, ...comments] = tree(document).children as TreeNode[];
    expect(section.children[0]).toEqual(
      node("Paragraph", {}, [
        node("CommentRangeStart", { id: 0 }),
        text("x"),
        node("CommentRangeEnd", { id: 0 }),
        node("TextRun", {}, [node("CommentReference", { id: 0 })]),
        node("CommentRangeStart", { id: 1 }),
        text("y"),
        node("CommentRangeEnd", { id: 1 }),
        node("TextRun", {}, [node("CommentReference", { id: 1 })]),
      ])
    );
    expect(comments).toEqual([
      node("Comment", { id: 0, author: "A", date: new Date(DATE) }, [paragraph("first")]),
      node("Comment", { id: 1, author: "B", initials: "BB", date: new Date("2026-02-01T00:00:00Z") }, [paragraph("second")]),
      node("Comment", { id: 2, author: "C" }, [paragraph("undated")]),
    ]);
    expect(comments[0].props.date).toBeInstanceOf(Date);
    expect(located(diagnostics, "dropped", "w:commentRangeStart")).toEqual([
      expect.objectContaining({ detail: "comment 9 is not in word/comments.xml" }),
    ]);
    expect(ignoredCount(diagnostics, "w:annotationRef")).toBe(3);
  });

  test("the comments part's threading companions are dropped by part", () => {
    const { diagnostics } = read({
      body: `<w:p>${run("x")}</w:p>`,
      comments: COMMENTS,
      parts: { "word/commentsExtended.xml": part("w15:commentsEx", "") },
    });
    expect(located(diagnostics, "dropped", "word/commentsExtended.xml")).toHaveLength(1);
  });
});

describe("tracked changes", () => {
  const change = (name: string, id: string, inside: string): string =>
    `<${name} w:id="${id}" w:author="A" w:date="${DATE}">${inside}</${name}>`;
  const tracked = { author: "A", date: DATE };

  test("a w:ins with two runs gives two InsertedTextRuns with the change's ordinal id and their own properties", () => {
    const [p] = blocksOf({ body: `<w:p>${change("w:ins", "40", `<w:r><w:rPr><w:b/></w:rPr><w:t>one</w:t></w:r>${run("two")}`)}</w:p>` });
    expect(p.children).toEqual([
      node("InsertedTextRun", { id: 1, ...tracked, bold: true }, ["one"]),
      node("InsertedTextRun", { id: 1, ...tracked }, ["two"]),
    ]);
  });

  test("a w:del gives a DeletedTextRun holding its w:delText as literal text", () => {
    const [p] = blocksOf({
      body: `<w:p>${change("w:ins", "7", run("in"))}${change("w:del", "8", "<w:r><w:delText>gone</w:delText></w:r>")}</w:p>`,
    });
    expect(p.children).toEqual([node("InsertedTextRun", { id: 1, ...tracked }, ["in"]), node("DeletedTextRun", { id: 2, ...tracked }, ["gone"])]);
  });

  test("w:moveTo is an InsertedTextRun with a resolved diagnostic, and the move range marks are ignored", () => {
    const { document, diagnostics } = read({
      body: `<w:p><w:moveToRangeStart w:id="1" w:name="move1"/>${change("w:moveTo", "2", run("moved"))}<w:moveToRangeEnd w:id="1"/></w:p>`,
    });
    expect(tree(tree(document).children[0]).children[0]).toEqual(
      node("Paragraph", {}, [node("InsertedTextRun", { id: 1, ...tracked }, ["moved"])])
    );
    expect(located(diagnostics, "resolved", "w:moveTo")).toEqual([expect.objectContaining({ detail: "move shown as insert/delete" })]);
    expect(ignoredCount(diagnostics, "w:moveToRangeStart")).toBe(1);
  });

  test("a w:ins around a hyperlink keeps the hyperlink and drops the w:ins", () => {
    const { document, diagnostics } = read({
      body: `<w:p>${change("w:ins", "3", `<w:hyperlink w:anchor="top">${run("link")}</w:hyperlink>`)}</w:p>`,
    });
    expect(tree(tree(document).children[0]).children[0]).toEqual(
      node("Paragraph", {}, [node("InternalHyperlink", { anchor: "top" }, [text("link")])])
    );
    expect(located(diagnostics, "dropped", "w:ins")).toHaveLength(1);
  });

  test.each([PageNumber.CURRENT, PageNumber.TOTAL_PAGES, PageNumber.TOTAL_PAGES_IN_SECTION, PageNumber.CURRENT_SECTION])(
    "a deleted %s page number reads back as a PageNumber in a DeletedTextRun",
    async (field) => {
      const element = h(
        Document,
        null,
        h(Section, null, h(Paragraph, null, h(DeletedTextRun, { id: 1, author: "A", date: DATE }, field)))
      );
      const { document } = readDocx(await renderToBuffer(element));
      expect(tree(tree(document).children[0]).children[0]).toEqual(
        node("Paragraph", {}, [node("DeletedTextRun", { id: 1, ...tracked }, [node("PageNumber", { field })])])
      );
    }
  );
});

describe("phase-1 cases", () => {
  type Listed = { readonly reference: string; readonly level: number; readonly instance: number };
  const listed = (document: TreeNode): Listed[] =>
    findAll(document, "Paragraph").flatMap((p) => {
      const numbering = p.props.numbering;
      return typeof numbering === "object" && numbering !== null ? [numbering as Listed] : [];
    });

  /** Each list paragraph's level, its reference renamed list-N by first appearance, and the index of the
   *  first paragraph sharing its (reference, instance). */
  function listShape(document: TreeNode) {
    const references = new Map<string, string>();
    const instances: string[] = [];
    return listed(document).map(({ reference, level, instance }) => {
      if (!references.has(reference)) references.set(reference, `list-${references.size + 1}`);
      const key = `${reference}#${instance}`;
      if (!instances.includes(key)) instances.push(key);
      return { reference: references.get(reference), level, sharesWith: instances.indexOf(key) };
    });
  }

  test.each(CASES.filter((c) => c.name === "bug-lists" || c.name === "notes-and-blocks").map((c) => [c.name, c.element] as const))(
    "%s reads back with the footnotes, comments and lists renderToTree gives",
    async (_name, element) => {
      const expected = tree(renderToTree(element));
      const actual = tree(readDocx(await renderToBuffer(element)).document);
      const compared = [...findAll(expected, "Footnote"), ...findAll(expected, "Comment"), ...listed(expected)];
      expect(compared.length).toBeGreaterThan(0);
      expect(findAll(actual, "Footnote")).toEqual(findAll(expected, "Footnote"));
      expect(findAll(actual, "Comment")).toEqual(findAll(expected, "Comment"));
      expect(listShape(actual)).toEqual(listShape(expected));
      expect(listed(actual).every(({ reference }) => /^list-\d+$/.test(reference))).toBe(true);
    }
  );
});

describe("styles whose id docx.js gives a built-in style of the other type", () => {
  const STRONG = '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>';
  const body = '<w:p><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>bold</w:t></w:r></w:p>';

  test("Word's character style Strong reads under a fresh id, its references follow it, and it round-trips", async () => {
    const read = readDocx(docx({ body, styles: STRONG }));
    const styles = tree(read.document).props.styles as { characterStyles?: { id: string }[] };
    expect(styles.characterStyles?.map((s) => s.id)).toEqual(["StrongChar"]);
    expect(findAll(tree(read.document), "TextRun")[0].props).toMatchObject({ style: "StrongChar" });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ kind: "resolved", element: "w:style" }));
    const again = readDocx(new Uint8Array(await renderToBuffer(read.document)));
    expect(findAll(tree(again.document), "TextRun")[0].props).toMatchObject({ style: "StrongChar" });
  });
});

describe("a table without its own borders", () => {
  const TABLE = (tblPr: string) =>
    `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>`;
  const STYLES =
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>' +
    '<w:style w:type="table" w:styleId="Lines"><w:name w:val="Lines"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:color="4472C4"/><w:insideH w:val="single" w:sz="4" w:color="4472C4"/></w:tblBorders></w:tblPr></w:style>';
  const bordersOf = (tblPr: string) =>
    findAll(tree(readDocx(docx({ body: TABLE(tblPr), styles: STYLES })).document), "Table")[0].props.borders as Record<string, { style: string }>;

  test("reads its table style's borders, and none for the sides the style leaves out, as Word draws it", () => {
    const borders = bordersOf('<w:tblStyle w:val="Lines"/>');
    expect(borders.top).toMatchObject({ style: "single", size: 8, color: "4472C4" });
    expect(borders.insideHorizontal).toMatchObject({ style: "single", size: 4 });
    expect([borders.left, borders.bottom, borders.right, borders.insideVertical].map((b) => b.style)).toEqual(["none", "none", "none", "none"]);
  });

  test("without a style it has the default table style's borders: none", () => {
    expect(Object.values(bordersOf("")).map((b) => b.style)).toEqual(["none", "none", "none", "none", "none", "none"]);
  });

  test("its own sides win over the style's", () => {
    expect(bordersOf('<w:tblStyle w:val="Lines"/><w:tblBorders><w:top w:val="double" w:sz="4"/></w:tblBorders>').top).toMatchObject({ style: "double" });
  });
});

describe("review fixes: reader", () => {
  test("a renamed style is renamed in XML kept verbatim too", () => {
    const styles = '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>';
    const body = '<w:p><w:sdt><w:sdtPr><w:alias w:val="x"/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>b</w:t></w:r></w:sdtContent></w:sdt></w:p>';
    const raw = findAll(tree(readDocx(docx({ body, styles })).document), "RawXml").map((n) => String(n.props.xml));
    expect(raw.join()).toContain('w:val="StrongChar"');
    expect(raw.join()).not.toContain('w:val="Strong"');
  });
});
