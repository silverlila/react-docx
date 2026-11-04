import { createElement as h, type ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  CheckBox,
  Document,
  PageReference,
  Paragraph,
  Section,
  SequentialIdentifier,
  SimpleField,
  SimpleMailMergeField,
  TableOfContents,
  renderToBuffer,
} from "../src/index";
import { readDocx, type Diagnostic } from "../src/read/index";
import { CASES } from "./support/cases";
import { docx, part } from "./support/docx-fixture";

type TreeNode = {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly (TreeNode | string)[];
};

const OFFICE_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HYPERLINK = `${OFFICE_RELS}/hyperlink`;
const HEADER = `${OFFICE_RELS}/header`;
const FOOTER = `${OFFICE_RELS}/footer`;

const rel = (id: string, type: string, target: string, external = false): string =>
  `<Relationship Id="${id}" Type="${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;

const relsPart = (inside: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inside}</Relationships>`;

const run = (text: string): string => `<w:r><w:t>${text}</w:t></w:r>`;
const fldChar = (type: string): string => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const instr = (code: string): string => `<w:r><w:instrText xml:space="preserve">${code}</w:instrText></w:r>`;

const tree = (value: unknown): TreeNode => value as TreeNode;
const sections = (bytes: Uint8Array) => tree(readDocx(bytes).document).children as TreeNode[];
const blocks = (bytes: Uint8Array) => sections(bytes)[0].children as TreeNode[];
const firstParagraph = (body: string) => blocks(docx({ body }))[0];
const diagnosticsOf = (bytes: Uint8Array): readonly Diagnostic[] => readDocx(bytes).diagnostics;

const node = (
  type: string,
  props: Record<string, unknown> = {},
  children: readonly (TreeNode | string)[] = [],
): TreeNode => ({
  type,
  props,
  children,
});

function find(root: TreeNode, type: string): TreeNode | undefined {
  if (root.type === type) return root;
  for (const child of root.children) {
    const found = typeof child === "string" ? undefined : find(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("runs and text", () => {
  test("one run keeps its properties and its text, tabs and text in order", () => {
    const p = firstParagraph("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hi</w:t><w:tab/><w:t>there</w:t></w:r></w:p>");
    expect(p).toEqual(node("Paragraph", {}, [node("TextRun", { bold: true }, ["Hi", node("Tab"), "there"])]));
  });

  test("a text break mid-run gives a second TextRun carrying break: 1", () => {
    const p = firstParagraph("<w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>");
    expect(p.children).toEqual([node("TextRun", {}, ["one"]), node("TextRun", { break: 1 }, ["two"])]);
  });

  test("a page break splits the run around a PageBreak", () => {
    const p = firstParagraph('<w:p><w:r><w:t>before</w:t><w:br w:type="page"/><w:t>after</w:t></w:r></w:p>');
    expect(p.children).toEqual([node("TextRun", {}, ["before"]), node("PageBreak"), node("TextRun", {}, ["after"])]);
  });

  test("text equal to a PageNumber value stays literal text", () => {
    const p = firstParagraph(`<w:p>${run("CURRENT")}</w:p>`);
    expect(p.children).toEqual([node("TextRun", { text: "CURRENT" })]);
  });
});

describe("fields", () => {
  test("a complex PAGE field over five runs becomes a TextRun holding PageNumber CURRENT", () => {
    const body = `<w:p>${fldChar("begin")}${instr(" PAGE ")}${fldChar("separate")}${run("4")}${fldChar("end")}</w:p>`;
    expect(firstParagraph(body).children).toEqual([node("TextRun", {}, [node("PageNumber", { field: "CURRENT" })])]);
  });

  test("NUMPAGES with \\* MERGEFORMAT is TOTAL_PAGES", () => {
    const body = `<w:p>${fldChar("begin")}${instr(" NUMPAGES  \\* MERGEFORMAT ")}${fldChar("separate")}${run("9")}${fldChar("end")}</w:p>`;
    expect(firstParagraph(body).children).toEqual([
      node("TextRun", {}, [node("PageNumber", { field: "TOTAL_PAGES" })]),
    ]);
  });

  test("a DATE field becomes one inline RawXml holding all its runs, with a raw diagnostic", () => {
    const field = `${fldChar("begin")}${instr(' DATE \\@ "d MMMM yyyy" ')}${fldChar("separate")}${run("3 November 2026")}${fldChar("end")}`;
    const bytes = docx({ body: `<w:p>${field}</w:p>` });
    expect(blocks(bytes)[0].children).toEqual([node("RawXml", { xml: field })]);
    expect(diagnosticsOf(bytes)).toContainEqual(
      expect.objectContaining({ kind: "raw", part: "word/document.xml", at: [0, 0], element: "w:fldChar" }),
    );
  });

  test.each<[string, ReactElement, TreeNode]>([
    [
      "SimpleField with a cached value",
      h(SimpleField, { instruction: "AUTHOR", cachedValue: "Ada" }),
      node("SimpleField", { instruction: "AUTHOR", cachedValue: "Ada" }),
    ],
    [
      "SimpleField without one",
      h(SimpleField, { instruction: "AUTHOR" }),
      node("SimpleField", { instruction: "AUTHOR" }),
    ],
    [
      "SimpleMailMergeField",
      h(SimpleMailMergeField, { fieldName: "First" }),
      node("SimpleMailMergeField", { fieldName: "First" }),
    ],
    [
      "SequentialIdentifier",
      h(SequentialIdentifier, { identifier: "Figure" }),
      node("SequentialIdentifier", { identifier: "Figure" }),
    ],
    [
      "PageReference",
      h(PageReference, { bookmarkId: "b1", hyperlink: true, useRelativePosition: true }),
      node("PageReference", { bookmarkId: "b1", hyperlink: true, useRelativePosition: true }),
    ],
    ["CheckBox", h(CheckBox, { checked: true, alias: "Done" }), node("CheckBox", { checked: true, alias: "Done" })],
  ])("%s reads back from docx.js output with the props it was written with", async (_name, element, expected) => {
    const bytes = await renderToBuffer(h(Document, {}, h(Section, {}, h(Paragraph, {}, element))));
    expect(blocks(bytes)[0].children).toEqual([expected]);
  });

  test("TableOfContents reads back from docx.js output with the props it was written with", async () => {
    const toc = h(TableOfContents, { alias: "Contents", headingStyleRange: "1-3", hyperlink: true });
    const bytes = await renderToBuffer(h(Document, {}, h(Section, {}, toc)));
    expect(blocks(bytes)).toEqual([
      node("TableOfContents", { alias: "Contents", headingStyleRange: "1-3", hyperlink: true }),
    ]);
  });

  test("a PAGEREF with a cached page number stays RawXml", () => {
    const field = `${fldChar("begin")}${instr(" PAGEREF b1 \\h ")}${fldChar("separate")}${run("3")}${fldChar("end")}`;
    expect(firstParagraph(`<w:p>${field}</w:p>`).children).toEqual([node("RawXml", { xml: field })]);
  });

  test("Word's TOC content control, with w:docPartObj and entries, stays block RawXml", () => {
    const toc =
      '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr>' +
      `<w:sdtContent><w:p>${fldChar("begin")}${instr(' TOC \\o "1-3" \\h \\z \\u ')}${fldChar("separate")}${run("Intro")}</w:p>` +
      `<w:p>${run("Method")}${fldChar("end")}</w:p></w:sdtContent></w:sdt>`;
    expect(blocks(docx({ body: toc }))).toEqual([node("RawXml", { xml: toc })]);
  });

  describe("a field whose result holds an element inline RawXml cannot hold is read as its result", () => {
    const field = (result: string) =>
      `<w:p>${fldChar("begin")}${instr(" DATE ")}${fldChar("separate")}${result}${fldChar("end")}</w:p>`;
    const fieldCodeDropped = (element: string) =>
      expect.objectContaining({
        kind: "dropped",
        at: [0, 0],
        element: "w:fldChar",
        detail: expect.stringContaining(`<${element}>`),
      });

    test("permStart and permEnd around the result text: the text is kept, the permission marks ignored", () => {
      const bytes = docx({
        body: field(`<w:permStart w:id="0" w:edGrp="everyone"/>${run("3 Nov")}<w:permEnd w:id="0"/>`),
      });
      expect(blocks(bytes)[0].children).toEqual([node("TextRun", {}, ["3 Nov"])]);
      expect(diagnosticsOf(bytes)).toContainEqual(fieldCodeDropped("w:permStart"));
    });

    test("w:dir in the result: the field code is dropped and w:dir goes through the inline fallback", () => {
      const bytes = docx({ body: field(`<w:dir w:val="rtl">${run("x")}</w:dir>`) });
      expect(blocks(bytes)[0]).toEqual(node("Paragraph"));
      expect(diagnosticsOf(bytes)).toContainEqual(fieldCodeDropped("w:dir"));
      expect(diagnosticsOf(bytes)).toContainEqual(expect.objectContaining({ kind: "dropped", element: "w:dir" }));
    });

    test("inline mc:AlternateContent in the result: its fallback's runs are read", () => {
      const alternate = `<mc:AlternateContent><mc:Choice Requires="w14"><w:r><w14:checkbox/></w:r></mc:Choice><mc:Fallback>${run("old")}</mc:Fallback></mc:AlternateContent>`;
      const bytes = docx({ body: field(alternate) });
      expect(blocks(bytes)[0].children).toEqual([node("TextRun", {}, ["old"])]);
      expect(diagnosticsOf(bytes)).toContainEqual(fieldCodeDropped("mc:AlternateContent"));
    });
  });

  test("a field that does not end in its paragraph is dropped and its result text kept", () => {
    const bytes = docx({
      body: `<w:p>${fldChar("begin")}${instr(" TOC \\o ")}${fldChar("separate")}${run("Entry")}</w:p><w:p>${fldChar("end")}</w:p>`,
    });
    expect(blocks(bytes)).toEqual([node("Paragraph", {}, [node("TextRun", {}, ["Entry"])]), node("Paragraph")]);
    expect(diagnosticsOf(bytes)).toContainEqual(
      expect.objectContaining({ kind: "dropped", at: [0, 0], element: "w:fldChar" }),
    );
  });
});

describe("hyperlinks", () => {
  test("an external hyperlink takes its link from the relationship, with w:anchor appended", () => {
    const bytes = docx({
      body: `<w:p><w:hyperlink r:id="rId1">${run("site")}</w:hyperlink><w:hyperlink r:id="rId1" w:anchor="part">${run("part")}</w:hyperlink></w:p>`,
      rels: rel("rId1", HYPERLINK, "https://example.com/a", true),
    });
    expect(blocks(bytes)[0].children).toEqual([
      node("ExternalHyperlink", { link: "https://example.com/a" }, [node("TextRun", {}, ["site"])]),
      node("ExternalHyperlink", { link: "https://example.com/a#part" }, [node("TextRun", {}, ["part"])]),
    ]);
  });

  test("a hyperlink in a header resolves against the header's own relationships", () => {
    const bytes = docx({
      body: '<w:p/><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
      rels: rel("rIdH", HEADER, "header1.xml") + rel("rId1", HYPERLINK, "https://body.example", true),
      parts: {
        "word/header1.xml": part("w:hdr", `<w:p><w:hyperlink r:id="rId1">${run("home")}</w:hyperlink></w:p>`),
        "word/_rels/header1.xml.rels": relsPart(rel("rId1", HYPERLINK, "https://header.example", true)),
      },
    });
    const header = blocks(bytes)[0];
    expect(find(header, "ExternalHyperlink")?.props).toEqual({ link: "https://header.example" });
  });

  test("an anchor-only hyperlink is an InternalHyperlink", () => {
    const p = firstParagraph(`<w:p><w:hyperlink w:anchor="top" w:history="1">${run("back")}</w:hyperlink></w:p>`);
    expect(p.children).toEqual([node("InternalHyperlink", { anchor: "top" }, [node("TextRun", {}, ["back"])])]);
  });
});

describe("bookmarks", () => {
  test("a bookmark opening and closing in one paragraph is a Bookmark named by w:name", () => {
    const p = firstParagraph(
      `<w:p><w:bookmarkStart w:id="7" w:name="intro"/>${run("text")}<w:bookmarkEnd w:id="7"/></w:p>`,
    );
    expect(p.children).toEqual([node("Bookmark", { id: "intro" }, [node("TextRun", {}, ["text"])])]);
  });

  test("bookmarks nested with the same w:id, as docx.js writes them, read back nested", () => {
    const p = firstParagraph(
      `<w:p><w:bookmarkStart w:name="outer" w:id="1"/>${run("a")}<w:bookmarkStart w:name="inner" w:id="1"/>${run("b")}` +
        '<w:bookmarkEnd w:id="1"/><w:bookmarkEnd w:id="1"/></w:p>',
    );
    expect(p.children).toEqual([
      node("Bookmark", { id: "outer" }, [
        node("TextRun", {}, ["a"]),
        node("Bookmark", { id: "inner" }, [node("TextRun", {}, ["b"])]),
      ]),
    ]);
  });

  test("a bookmark spanning paragraphs becomes two RawXml with its id moved to 100001", () => {
    const bytes = docx({
      body: `<w:p><w:bookmarkStart w:id="0" w:name="span"/>${run("a")}</w:p><w:p>${run("b")}<w:bookmarkEnd w:id="0"/></w:p>`,
    });
    const [first, second] = blocks(bytes);
    expect(first.children[0]).toEqual(node("RawXml", { xml: '<w:bookmarkStart w:id="100001" w:name="span"/>' }));
    expect(second.children[1]).toEqual(node("RawXml", { xml: '<w:bookmarkEnd w:id="100001"/>' }));
  });

  test("a bookmark ending inside a field kept as RawXml has both halves moved to the same id", () => {
    const fieldTail = `${fldChar("begin")}${instr(" DATE ")}${fldChar("separate")}${run("3 Nov")}`;
    const p = firstParagraph(
      `<w:p><w:bookmarkStart w:id="7" w:name="bm"/>${fieldTail}<w:bookmarkEnd w:id="7"/>${fldChar("end")}</w:p>`,
    );
    expect(p.children).toEqual([
      node("RawXml", { xml: '<w:bookmarkStart w:id="100001" w:name="bm"/>' }),
      node("RawXml", { xml: `${fieldTail}<w:bookmarkEnd w:id="100001"/>${fldChar("end")}` }),
    ]);
  });

  test("Word's _GoBack bookmark is ignored", () => {
    const bytes = docx({
      body: `<w:p>${run("a")}<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/></w:p>`,
    });
    expect(blocks(bytes)[0].children).toEqual([node("TextRun", {}, ["a"])]);
    expect(diagnosticsOf(bytes)).toEqual([{ kind: "ignored", element: "_GoBack", count: 1 }]);
  });
});

describe("tables", () => {
  test("column spans and vertical merges read onto the cells, one TableCell per w:tc", () => {
    const cell = (tcPr: string) => `<w:tc>${tcPr === "" ? "" : `<w:tcPr>${tcPr}</w:tcPr>`}<w:p/></w:tc>`;
    const body =
      '<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>' +
      `<w:tr>${cell('<w:vMerge w:val="restart"/>')}${cell('<w:gridSpan w:val="2"/>')}</w:tr>` +
      `<w:tr>${cell("<w:vMerge/>")}${cell("")}${cell("")}</w:tr></w:tbl>`;
    const rows = blocks(docx({ body }))[0].children as TreeNode[];
    expect(rows.map((row) => row.children.map((c) => (c as TreeNode).props))).toEqual([
      [{ verticalMerge: "restart" }, { columnSpan: 2 }],
      [{ verticalMerge: "continue" }, {}, {}],
    ]);
  });

  test("a cell ending in a table gets an empty Paragraph after it", () => {
    const inner = `<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`;
    const cell = (
      blocks(docx({ body: `<w:tbl><w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl>` }))[0].children[0] as TreeNode
    ).children[0] as TreeNode;
    expect(cell.children.map((child) => (child as TreeNode).type)).toEqual(["Table", "Paragraph"]);
  });
});

describe("sections", () => {
  test("a paragraph holding w:sectPr ends its section and stays in it", () => {
    const body =
      `<w:p>${run("one")}</w:p><w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>${run("end of one")}</w:p>` +
      `<w:p>${run("two")}</w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`;
    const [first, second] = sections(docx({ body }));
    expect(first.children.map((p) => (p as TreeNode).children)).toEqual([
      [node("TextRun", {}, ["one"])],
      [node("TextRun", {}, ["end of one"])],
    ]);
    expect(first.props).toEqual({ properties: { page: { size: { width: 12240, height: 15840 } } } });
    expect(second.children).toEqual([node("Paragraph", {}, [node("TextRun", {}, ["two"])])]);
    expect(second.props).toEqual({ properties: { page: { size: { width: 11906, height: 16838 } } } });
  });

  test("an empty paragraph holding only w:sectPr is the section break docx.js writes, not a Paragraph", () => {
    const body = `<w:p>${run("one")}</w:p><w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:p>${run("two")}</w:p>`;
    expect(sections(docx({ body })).map((section) => section.children.length)).toEqual([1, 1]);
  });

  test("header and footer references become Header and Footer children before the body", () => {
    const bytes = docx({
      body:
        `<w:p>${run("body")}</w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/>` +
        '<w:headerReference w:type="first" r:id="rIdH2"/><w:footerReference w:type="default" r:id="rIdF1"/><w:titlePg/></w:sectPr>',
      rels:
        rel("rIdH1", HEADER, "header1.xml") + rel("rIdH2", HEADER, "header2.xml") + rel("rIdF1", FOOTER, "footer1.xml"),
      parts: {
        "word/header1.xml": part("w:hdr", `<w:p>${run("every page")}</w:p>`),
        "word/header2.xml": part("w:hdr", `<w:p>${run("first page")}</w:p>`),
        "word/footer1.xml": part("w:ftr", `<w:p>${run("foot")}</w:p>`),
      },
    });
    const text = (t: string) => [node("Paragraph", {}, [node("TextRun", {}, [t])])];
    expect(blocks(bytes)).toEqual([
      node("Header", { type: "default" }, text("every page")),
      node("Header", { type: "first" }, text("first page")),
      node("Footer", { type: "default" }, text("foot")),
      ...text("body"),
    ]);
  });
});

describe("document properties and settings", () => {
  test("core and custom properties, background and settings read back from docx.js output", async () => {
    const document = h(
      Document,
      {
        title: "Report",
        subject: "Q3",
        keywords: "a, b",
        description: "About",
        customProperties: [{ name: "Client", value: "Acme" }],
        background: { color: "FFEEDD" },
        evenAndOddHeaderAndFooters: true,
        defaultTabStop: 720,
        features: { updateFields: true, trackRevisions: true },
      },
      h(Section, {}, h(Paragraph, {}, "x")),
    );
    const bytes = await renderToBuffer(document);
    const { styles: _styles, ...props } = tree(readDocx(bytes).document).props;
    expect(props).toEqual({
      title: "Report",
      subject: "Q3",
      keywords: "a, b",
      description: "About",
      creator: "Un-named",
      lastModifiedBy: "Un-named",
      revision: 1,
      customProperties: [{ name: "Client", value: "Acme" }],
      background: { color: "FFEEDD" },
      evenAndOddHeaderAndFooters: true,
      defaultTabStop: 720,
      features: { updateFields: true, trackRevisions: true },
    });
  });

  test("a part no reader reads is reported dropped by its path", () => {
    const bytes = docx({ body: "<w:p/>", parts: { "word/endnotes.xml": part("w:endnotes", "") } });
    expect(diagnosticsOf(bytes)).toContainEqual(
      expect.objectContaining({ kind: "dropped", part: "word/endnotes.xml", at: null, element: "word/endnotes.xml" }),
    );
  });
});

describe("styles", () => {
  const styles =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="MyStyle"><w:name w:val="My Style"/></w:style>';
  const read = () =>
    tree(readDocx(docx({ body: `<w:p><w:pPr><w:pStyle w:val="MyStyle"/></w:pPr>${run("x")}</w:p>`, styles })).document);

  test("Word's default style Normal is kept raw in importedStyles", () => {
    expect(read().props.styles).toMatchObject({
      importedStyles: [
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
      ],
    });
  });

  test("Heading1 lands in styles.default.heading1 through canonicalize", () => {
    expect(read().props.styles).toMatchObject({
      default: { heading1: { name: "heading 1", basedOn: "Normal", run: { bold: true } } },
    });
  });

  test("a custom style stays in paragraphStyles and the paragraph keeps its style id", () => {
    const document = read();
    expect(document.props.styles).toMatchObject({ paragraphStyles: [{ id: "MyStyle", name: "My Style" }] });
    expect(find(document, "Paragraph")?.props).toEqual({ style: "MyStyle" });
  });
});

describe("the generic fallback", () => {
  test("a w:sdt with no r: attribute is kept as block RawXml", () => {
    const sdt = `<w:sdt><w:sdtPr><w:alias w:val="Note"/></w:sdtPr><w:sdtContent><w:p>${run("in control")}</w:p></w:sdtContent></w:sdt>`;
    const bytes = docx({ body: sdt });
    expect(blocks(bytes)).toEqual([node("RawXml", { xml: sdt })]);
    expect(diagnosticsOf(bytes)).toContainEqual(expect.objectContaining({ kind: "raw", at: [0, 0], element: "w:sdt" }));
  });

  test("a w:sdt whose text reads like an r: attribute is still kept as block RawXml", () => {
    const sdt = `<w:sdt><w:sdtContent><w:p>${run("see r:id= here")}</w:p></w:sdtContent></w:sdt>`;
    expect(blocks(docx({ body: sdt }))).toEqual([node("RawXml", { xml: sdt })]);
  });

  test("a w:sdt holding a relationship is unwrapped: its content is read and the w:sdt dropped", () => {
    const bytes = docx({
      body: `<w:sdt><w:sdtContent><w:p><w:hyperlink r:id="rId1">${run("link")}</w:hyperlink></w:p></w:sdtContent></w:sdt>`,
      rels: rel("rId1", HYPERLINK, "https://example.com", true),
    });
    expect(blocks(bytes)).toEqual([
      node("Paragraph", {}, [
        node("ExternalHyperlink", { link: "https://example.com" }, [node("TextRun", {}, ["link"])]),
      ]),
    ]);
    expect(diagnosticsOf(bytes)).toContainEqual(expect.objectContaining({ kind: "dropped", element: "w:sdt" }));
  });

  test("an element with no kind and no RawXml slot is dropped", () => {
    const bytes = docx({ body: `<w:p><w:r><w:t>a</w:t><w:foo/></w:r></w:p>` });
    expect(blocks(bytes)[0].children).toEqual([node("TextRun", {}, ["a"])]);
    expect(diagnosticsOf(bytes)).toEqual([
      { kind: "dropped", part: "word/document.xml", at: [0, 0], element: "w:foo", detail: "no tree kind maps it" },
    ]);
  });

  test("w:rsid attributes produce no diagnostic", () => {
    expect(
      diagnosticsOf(
        docx({ body: `<w:p w:rsidR="00A1" w:rsidRDefault="00B2"><w:r w:rsidRPr="00C3"><w:t>x</w:t></w:r></w:p>` }),
      ),
    ).toEqual([]);
  });

  test("w:proofErr is counted ignored", () => {
    const bytes = docx({
      body: `<w:p><w:proofErr w:type="spellStart"/>${run("teh")}<w:proofErr w:type="spellEnd"/></w:p>`,
    });
    expect(diagnosticsOf(bytes)).toEqual([{ kind: "ignored", element: "w:proofErr", count: 2 }]);
  });
});

describe("paths", () => {
  test("a dropped element in the second paragraph of the first section is at [0, 1]", () => {
    const bytes = docx({ body: `<w:p>${run("a")}</w:p><w:p><w:r><w:foo/></w:r></w:p>` });
    expect(diagnosticsOf(bytes)).toContainEqual(expect.objectContaining({ element: "w:foo", at: [0, 1] }));
  });

  test("body block paths count the section's Header and Footer children", () => {
    const bytes = docx({
      body: '<w:p><w:r><w:foo/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>',
      rels: rel("rIdH", HEADER, "header1.xml"),
      parts: { "word/header1.xml": part("w:hdr", "<w:p><w:r><w:bar/></w:r></w:p>") },
    });
    expect(diagnosticsOf(bytes)).toEqual([
      expect.objectContaining({ part: "word/document.xml", at: [0, 1], element: "w:foo" }),
      expect.objectContaining({ part: "word/header1.xml", at: [0, 0, 0], element: "w:bar" }),
    ]);
  });
});

describe("phase-1 cases", () => {
  test.each(CASES.map((c) => [c.name, c.element] as const))("%s reads without throwing", async (_name, element) => {
    const { document } = readDocx(await renderToBuffer(element));
    expect(document.type).toBe("Document");
  });
});
