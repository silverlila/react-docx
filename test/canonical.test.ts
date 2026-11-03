import { describe, expect, test } from "vitest";
import { DEFAULT_NUMBERING } from "../src/constants";
import type { DocumentNode } from "../src/schema/elements";
import { canonicalize, TreeError, type AuthorNode } from "../src/tree/canonical";
import { LIST_NUMBERING } from "../src/tree/lists";
import { xmlRoots } from "../src/tree/xml-roots";
import { n } from "./support/nodes";

/** canonicalize, asserting on every input that it is left untouched and that a second pass changes nothing. */
function canon(input: AuthorNode): DocumentNode {
  const before = structuredClone(input);
  const output = canonicalize(input);
  expect(input, "canonicalize mutated its input").toEqual(before);
  expect(canonicalize(output), "canonicalize is not idempotent here").toEqual(output);
  return output;
}

const doc = (...blocks: (AuthorNode | string)[]) => n("Document", {}, n("Section", {}, ...blocks));
const blocks = (tree: DocumentNode) => tree.children[0].children;
const inline = (tree: DocumentNode) => (blocks(tree)[0] as { children: unknown }).children;

const run = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: "TextRun", props, children });
const tab = { type: "Tab", props: {}, children: [] };
const page = (field: string) => ({ type: "PageNumber", props: { field }, children: [] });
const paragraph = (props: Record<string, unknown>, ...children: unknown[]) => ({ type: "Paragraph", props, children });
/** The tracked-change run kinds, which rules 1, 4 and 6 treat as they treat TextRun. */
const TRACKED = ["InsertedTextRun", "DeletedTextRun"];
const change = { id: 1, author: "A", date: "2026-01-01T00:00:00Z" };
const runOf = (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children });

function treeError(build: () => unknown): TreeError {
  try {
    build();
  } catch (error) {
    if (error instanceof TreeError) return error;
    throw error;
  }
  throw new Error("expected a TreeError, nothing was thrown");
}

describe("1. strings directly in a TextRun", () => {
  test.each(["CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", "SECTION"])(
    'the string "%s" becomes a PageNumber field',
    (field) => {
      expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", {}, field)))))).toEqual([run({}, page(field))]);
    }
  );

  test("other strings stay literal, adjacent ones merge and empty ones drop", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", {}, "a", "", "b", n("Tab"), "c"))));
    expect(inline(tree)).toEqual([run({}, "ab", tab, "c")]);
  });

  test('folio\'s idiom: <TextRun children={["Page ", PageNumber.CURRENT]} /> gives text then a field', () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { children: undefined }, "Page ", "CURRENT"))));
    expect(inline(tree)).toEqual([run({}, "Page ", page("CURRENT"))]);
  });

  test("strings that merge into a PageNumber value stay literal, as the text of a run of their own", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", {}, "CURR", "ENT")))))).toEqual([run({ text: "CURRENT" })]);
  });

  test("a merged PageNumber value splits its run, and only the first part keeps break", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { italics: true, break: 1 }, "a", n("Tab"), "CURR", "ENT", n("Tab")))));
    expect(inline(tree)).toEqual([
      run({ italics: true, break: 1 }, "a", tab),
      run({ italics: true, text: "CURRENT" }),
      run({ italics: true }, tab),
    ]);
  });

  test.each(TRACKED)('in a %s, "CURRENT" becomes a PageNumber field and other strings merge', (kind) => {
    const tree = canon(doc(n("Paragraph", {}, n(kind, change, "Page ", "", "CURRENT"))));
    expect(inline(tree)).toEqual([runOf(kind, change, "Page ", page("CURRENT"))]);
  });

  test.each(TRACKED)("in a %s, strings that merge into a PageNumber value are the text of a run of the same kind", (kind) => {
    expect(inline(canon(doc(n("Paragraph", {}, n(kind, change, "a", n("Tab"), "TOTAL_", "PAGES")))))).toEqual([
      runOf(kind, change, "a", tab),
      runOf(kind, { ...change, text: "TOTAL_PAGES" }),
    ]);
  });
});

describe("2. strings directly in an inline slot", () => {
  test("consecutive strings in a Paragraph merge into one TextRun", () => {
    expect(inline(canon(doc(n("Paragraph", {}, "a", "b", n("TextRun", {}, "c")))))).toEqual([
      run({}, "ab"),
      run({}, "c"),
    ]);
  });

  test('"CURRENT" directly in a Paragraph stays literal text, as the text of its run, not a field', () => {
    expect(inline(canon(doc(n("Paragraph", {}, "CURRENT"))))).toEqual([run({ text: "CURRENT" })]);
  });

  test("strings in a hyperlink or bookmark are wrapped the same way", () => {
    const tree = canon(
      doc(n("Paragraph", {}, n("ExternalHyperlink", { link: "https://x.test" }, "go"), n("Bookmark", { id: "b" }, "here")))
    );
    expect(inline(tree)).toEqual([
      { type: "ExternalHyperlink", props: { link: "https://x.test" }, children: [run({}, "go")] },
      { type: "Bookmark", props: { id: "b" }, children: [run({}, "here")] },
    ]);
  });
});

describe("3. strings elsewhere", () => {
  test("strings directly in Math are wrapped in a MathRun", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("Math", {}, "x", "+1")))))).toEqual([
      { type: "Math", props: {}, children: [{ type: "MathRun", props: {}, children: ["x+1"] }] },
    ]);
  });

  test("strings in a MathRun are literal, even a PageNumber value", () => {
    const tree = canon(doc(n("Paragraph", {}, n("Math", {}, n("MathRun", {}, "CURRENT")))));
    expect(inline(tree)).toEqual([
      { type: "Math", props: {}, children: [{ type: "MathRun", props: {}, children: ["CURRENT"] }] },
    ]);
  });

  test("text directly in a Table throws", () => {
    const error = treeError(() => canon(doc(n("Table", {}, "oops"))));
    expect(error.path).toEqual(["Document", "Section[0]", "Table[0]"]);
    expect(error.message).toBe("Document > Section[0] > Table[0]: Text is not allowed directly in <Table>");
  });
});

describe("4. the text prop", () => {
  test("on a TextRun it becomes the first child, kept alongside the children", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { text: "a", bold: true }, n("Tab"), "b"))));
    expect(inline(tree)).toEqual([run({ bold: true }, "a", tab, "b")]);
  });

  test("on a TextRun it is literal even when it equals a PageNumber value, and stays the run's text", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", { text: "CURRENT" })))))).toEqual([
      run({ text: "CURRENT" }),
    ]);
  });

  test('an empty text on a TextRun is kept, as docx.js writes it: <w:t xml:space="preserve"></w:t>', () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", { text: "" })))))).toEqual([run({ text: "" })]);
  });

  test("a text that merges with a child string into a PageNumber value stays literal", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", { text: "CUR" }, "RENT")))))).toEqual([
      run({ text: "CURRENT" }),
    ]);
  });

  test("a kept text with children is a run of its own; the children follow with the same props, minus break", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { text: "TOTAL_PAGES", bold: true, break: 1 }, n("Tab"), "b"))));
    expect(inline(tree)).toEqual([run({ bold: true, break: 1, text: "TOTAL_PAGES" }), run({ bold: true }, tab, "b")]);
  });

  test("a kept empty text never merges with the strings after it", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("TextRun", { text: "" }, "a")))))).toEqual([
      run({ text: "" }),
      run({}, "a"),
    ]);
  });

  test("on a Paragraph it becomes a leading TextRun, before the children", () => {
    const tree = canon(doc(n("Paragraph", { text: "a" }, n("TextRun", {}, "b"))));
    expect(blocks(tree)).toEqual([paragraph({}, run({}, "a"), run({}, "b"))]);
  });

  test("on a Paragraph, a PageNumber value becomes a leading TextRun with that text", () => {
    expect(blocks(canon(doc(n("Paragraph", { text: "SECTION" }))))).toEqual([paragraph({}, run({ text: "SECTION" }))]);
  });

  test("an empty text on a Paragraph inserts nothing, as docx.js ignores it", () => {
    expect(blocks(canon(doc(n("Paragraph", { text: "" }))))).toEqual([paragraph({})]);
  });

  test("on Math it becomes a leading MathRun", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("Math", { text: "x+1" })))))).toEqual([
      { type: "Math", props: {}, children: [{ type: "MathRun", props: {}, children: ["x+1"] }] },
    ]);
  });

  test.each(TRACKED)("on a %s it becomes the first child, and stays the text when it is a PageNumber value", (kind) => {
    const tree = canon(doc(n("Paragraph", {}, n(kind, { ...change, text: "a" }, "b"), n(kind, { ...change, text: "SECTION" }))));
    expect(inline(tree)).toEqual([
      runOf(kind, change, "ab"),
      runOf(kind, { ...change, text: "SECTION" }),
    ]);
  });

  test("a non-string text throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("TextRun", { text: 5 }))))).toThrow(
      "Document > Section[0] > Paragraph[0] > TextRun[0]: text must be a string, got number"
    );
  });
});

describe("5. run content directly in an inline slot", () => {
  test("a Tab in a Paragraph is wrapped in its own TextRun", () => {
    expect(inline(canon(doc(n("Paragraph", {}, "a", n("Tab"), n("Tab")))))).toEqual([
      run({}, "a"),
      run({}, tab),
      run({}, tab),
    ]);
  });

  test("a PageNumber node in a hyperlink is wrapped in a TextRun", () => {
    const tree = canon(doc(n("Paragraph", {}, n("InternalHyperlink", { anchor: "a" }, n("PageNumber", { field: "TOTAL_PAGES" })))));
    expect(inline(tree)).toEqual([
      { type: "InternalHyperlink", props: { anchor: "a" }, children: [run({}, page("TOTAL_PAGES"))] },
    ]);
  });

  test.each(["PositionalTab", "CarriageReturn", "SoftHyphen", "NoBreakHyphen", "DayShort", "YearLong"])(
    "a %s in a Paragraph is wrapped in its own TextRun",
    (kind) => {
      expect(inline(canon(doc(n("Paragraph", {}, n(kind)))))).toEqual([run({}, { type: kind, props: {}, children: [] })]);
    }
  );

  test.each(TRACKED)("a %s in a Paragraph is not wrapped, and holds run content", (kind) => {
    expect(inline(canon(doc(n("Paragraph", {}, n(kind, change, n("Tab"), n("CarriageReturn"))))))).toEqual([
      runOf(kind, change, tab, { type: "CarriageReturn", props: {}, children: [] }),
    ]);
  });

  test("a Tab in a Section is not wrapped and throws", () => {
    expect(() => canon(doc(n("Tab")))).toThrow("Document > Section[0] > Tab[0]: <Tab> is not allowed in <Section>");
  });
});

describe("6. Break", () => {
  test("a Break in a Paragraph becomes TextRun { break: 1 }", () => {
    expect(inline(canon(doc(n("Paragraph", {}, "a", n("Break"), "b"))))).toEqual([
      run({}, "a"),
      run({ break: 1 }),
      run({}, "b"),
    ]);
  });

  test("consecutive Breaks in a Paragraph merge into one break count", () => {
    expect(inline(canon(doc(n("Paragraph", {}, n("Break"), n("Break"), n("Break")))))).toEqual([run({ break: 3 })]);
  });

  test("<TextRun>a<Break/>b</TextRun> becomes two runs with the same props", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { bold: true }, "a", n("Break"), "b"))));
    expect(inline(tree)).toEqual([run({ bold: true }, "a"), run({ bold: true, break: 1 }, "b")]);
  });

  test("k consecutive Breaks inside a run give the next run break: k", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { text: "a" }, n("Break"), n("Break"), "b", n("Break"), n("Tab")))));
    expect(inline(tree)).toEqual([run({}, "a"), run({ break: 2 }, "b"), run({ break: 1 }, tab)]);
  });

  test("Breaks before any content add to the run's own leading count", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { break: 1 }, n("Break"), n("Break"), "a"))));
    expect(inline(tree)).toEqual([run({ break: 3 }, "a")]);
  });

  test("a trailing Break produces a final run with no children", () => {
    const tree = canon(doc(n("Paragraph", {}, n("TextRun", { italics: true }, "a", n("Break")))));
    expect(inline(tree)).toEqual([run({ italics: true }, "a"), run({ italics: true, break: 1 })]);
  });

  test.each(TRACKED)("a Break inside a %s splits it into two of the same kind with the same props", (kind) => {
    const tree = canon(doc(n("Paragraph", {}, n(kind, { ...change, bold: true }, "a", n("Break"), "b"))));
    expect(inline(tree)).toEqual([
      runOf(kind, { ...change, bold: true }, "a"),
      runOf(kind, { ...change, bold: true, break: 1 }, "b"),
    ]);
  });

  test("a Break in a Section throws", () => {
    expect(() => canon(doc(n("Break")))).toThrow("Document > Section[0] > Break[0]: <Break> is not allowed in <Section>");
  });

  test("a Break in Math throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("Math", {}, n("Break")))))).toThrow(
      "Document > Section[0] > Paragraph[0] > Math[0] > Break[0]: <Break> is not allowed in <Math>"
    );
  });
});

describe("7. heading", () => {
  test('heading: "Heading1" becomes style: "Heading1"', () => {
    expect(blocks(canon(doc(n("Paragraph", { heading: "Heading1" }))))).toEqual([paragraph({ style: "Heading1" })]);
  });

  test("a heading equal to style is dropped", () => {
    expect(blocks(canon(doc(n("Paragraph", { heading: "Heading1", style: "Heading1" }))))).toEqual([
      paragraph({ style: "Heading1" }),
    ]);
  });

  test("a heading that differs from style throws", () => {
    expect(() => canon(doc(n("Paragraph", { heading: "Heading1", style: "Quote" })))).toThrow(
      'Document > Section[0] > Paragraph[0]: heading="Heading1" and style="Quote" conflict; use one'
    );
  });

  test("a ListItem's heading becomes its paragraph's style", () => {
    const tree = canon(doc(n("ListItem", { heading: "Heading2" }, "x")));
    expect(blocks(tree)).toEqual([paragraph({ style: "Heading2" }, run({}, "x"))]);
  });
});

describe("8. presence-only booleans", () => {
  // docx.js 9.5.1 writes every boolean option as w:val="false" when false (test/presence-booleans.test.ts),
  // so PRESENCE_ONLY is empty and no false boolean is removed.
  test("false booleans are kept, including tableHeader and a nested section property", () => {
    const tree = canon(
      n(
        "Document",
        {},
        n(
          "Section",
          { properties: { titlePage: false } },
          n("Table", {}, n("TableRow", { tableHeader: false }, n("TableCell", {}, n("Paragraph"))))
        )
      )
    );
    expect(tree.children[0].props).toEqual({ properties: { titlePage: false } });
    expect(blocks(tree)[0]).toMatchObject({ children: [{ props: { tableHeader: false } }] });
  });
});

describe("9. Header and Footer", () => {
  test('a missing type becomes "default"', () => {
    const tree = canon(doc(n("Header", {}, n("Paragraph")), n("Footer", { type: "first" }, n("Paragraph"))));
    expect(blocks(tree)).toEqual([
      { type: "Header", props: { type: "default" }, children: [paragraph({})] },
      { type: "Footer", props: { type: "first" }, children: [paragraph({})] },
    ]);
  });

  test("a Header and a Footer of each type may share a Section", () => {
    const tree = canon(doc(n("Header"), n("Header", { type: "even" }), n("Footer"), n("Footer", { type: "even" })));
    expect(blocks(tree)).toHaveLength(4);
  });

  test("a second Header of the same type in one Section throws", () => {
    const error = treeError(() => canon(doc(n("Header"), n("Paragraph"), n("Header", { type: "default" }))));
    expect(error.path).toEqual(["Document", "Section[0]", "Header[2]"]);
    expect(error.message).toContain('A second <Header type="default"> in one <Section>');
  });

  test("a second Footer of the same type in one Section throws", () => {
    expect(() => canon(doc(n("Footer", { type: "first" }), n("Footer", { type: "first" })))).toThrow(
      'Document > Section[0] > Footer[1]: A second <Footer type="first"> in one <Section>'
    );
  });
});

describe("10. placement", () => {
  test("a Paragraph inside a Paragraph throws with the full path", () => {
    const error = treeError(() =>
      canon(doc(n("Paragraph"), n("Paragraph", {}, n("TextRun", {}, "a"), n("Paragraph"))))
    );
    expect(error).toBeInstanceOf(TreeError);
    expect(error.name).toBe("TreeError");
    expect(error.path).toEqual(["Document", "Section[0]", "Paragraph[1]", "Paragraph[1]"]);
    expect(error.message).toBe("Document > Section[0] > Paragraph[1] > Paragraph[1]: <Paragraph> is not allowed in <Paragraph>");
  });

  test("a TableCell directly in a Table throws with the full path", () => {
    const error = treeError(() => canon(doc(n("Table", {}, n("TableRow", {}, n("TableCell")), n("TableCell")))));
    expect(error.path).toEqual(["Document", "Section[0]", "Table[0]", "TableCell[1]"]);
    expect(error.message).toContain("<TableCell> is not allowed in <Table>");
  });

  test("an unknown element throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("Marquee"))))).toThrow(
      "Document > Section[0] > Paragraph[0] > Marquee[0]: Unknown element <Marquee>"
    );
  });

  test("the root must be a Document", () => {
    const error = treeError(() => canon(n("Section")));
    expect(error.path).toEqual(["Section"]);
    expect(error.message).toBe("Section: The root must be <Document>, got <Section>");
  });

  test("a leaf with children throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("PageBreak", {}, n("TextRun")))))).toThrow(
      "<TextRun> is not allowed in <PageBreak>"
    );
  });
});

describe("11. image data", () => {
  const image = (data: unknown, extra: Record<string, unknown> = {}) =>
    doc(n("Paragraph", {}, n("ImageRun", { type: "png", transformation: { width: 1, height: 1 }, data, ...extra })));
  const imageProps = (tree: DocumentNode) => (inline(tree) as { props: Record<string, unknown> }[])[0].props;

  test("a base64 string is decoded", () => {
    expect(imageProps(canon(image("AQID"))).data).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("a data: URL prefix is stripped before decoding", () => {
    expect(imageProps(canon(image("data:image/png;base64,AQID"))).data).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("an ArrayBuffer is wrapped", () => {
    expect(imageProps(canon(image(new Uint8Array([4, 5]).buffer))).data).toEqual(new Uint8Array([4, 5]));
  });

  // Not through canon(): structuredClone turns a Buffer into a Uint8Array, so its purity check cannot see this input.
  test("a Node Buffer is copied into a plain Uint8Array", () => {
    const buffer = Buffer.from([6, 7]);
    const tree = canonicalize(image(buffer));
    const data = imageProps(tree).data;
    expect(Object.getPrototypeOf(data)).toBe(Uint8Array.prototype);
    expect(data).toEqual(new Uint8Array([6, 7]));
    expect(data).not.toBe(buffer);
    expect(canonicalize(tree)).toEqual(tree);
  });

  test("an SVG's fallback data is converted the same way", () => {
    const props = imageProps(canon(image("PHN2Zy8+", { type: "svg", fallback: { type: "png", data: "AQID" } })));
    expect(props.data).toEqual(new TextEncoder().encode("<svg/>"));
    expect(props.fallback).toEqual({ type: "png", data: new Uint8Array([1, 2, 3]) });
  });
});

describe("12. style folding", () => {
  const styled = (styles: Record<string, unknown>) => canon(n("Document", { styles }, n("Section")));

  test("a Heading1 paragraph style moves into styles.default.heading1, without its id", () => {
    const tree = styled({
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", run: { bold: true } },
        { id: "Quote", name: "Quote" },
      ],
    });
    expect(tree.props.styles).toEqual({
      default: { heading1: { name: "Heading 1", run: { bold: true } } },
      paragraphStyles: [{ id: "Quote", name: "Quote" }],
    });
  });

  test("a folded style replaces an existing styles.default entry and keeps the others", () => {
    const tree = styled({
      default: { heading1: { run: { size: 40 } }, document: { run: { font: "Arial" } } },
      paragraphStyles: [{ id: "Heading1", run: { size: 32 } }],
    });
    expect(tree.props.styles).toEqual({
      default: { heading1: { run: { size: 32 } }, document: { run: { font: "Arial" } } },
    });
  });

  test("a Hyperlink character style moves into styles.default.hyperlink and the empty list is dropped", () => {
    const tree = styled({ characterStyles: [{ id: "Hyperlink", run: { color: "0000FF" } }] });
    expect(tree.props.styles).toEqual({ default: { hyperlink: { run: { color: "0000FF" } } } });
  });

  test("a paragraph style with a character style's id throws", () => {
    expect(() => styled({ paragraphStyles: [{ id: "Hyperlink" }] })).toThrow(
      'Document: styles.paragraphStyles entry "Hyperlink" is docx.js\'s built-in character style'
    );
  });

  test("a character style with a paragraph style's id throws", () => {
    expect(() => styled({ characterStyles: [{ id: "Heading2" }] })).toThrow(
      'Document: styles.characterStyles entry "Heading2" is docx.js\'s built-in paragraph style'
    );
  });

  test("folio's styles.default.* passes through untouched", () => {
    const styles = {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
        heading1: { run: { size: 32, bold: true }, paragraph: { spacing: { before: 240 } } },
      },
    };
    expect(styled(styles).props.styles).toEqual(styles);
  });
});

describe("xmlRoots", () => {
  test("names each top-level element of a fragment, in order", () => {
    expect(xmlRoots('<w:fldChar w:fldCharType="begin"/><w:instrText> DATE </w:instrText><w:fldChar/>')).toEqual({
      kind: "roots",
      roots: ["w:fldChar", "w:instrText", "w:fldChar"],
    });
  });

  test("does not name nested elements, even one with the same name as its parent", () => {
    expect(xmlRoots("<w:sdt><w:sdtContent><w:sdt><w:p/></w:sdt></w:sdtContent></w:sdt>")).toEqual({
      kind: "roots",
      roots: ["w:sdt"],
    });
  });

  test("a > inside a quoted attribute value does not end the tag", () => {
    expect(xmlRoots(`<w:r w:a="x>y" w:b='/>'><w:t>a</w:t></w:r><w:r/>`)).toEqual({ kind: "roots", roots: ["w:r", "w:r"] });
  });

  test("skips whitespace, comments, processing instructions and CDATA inside an element", () => {
    const xml = ' <!-- <w:p> --> <?mso-application x?>\n<w:r><w:t><![CDATA[</w:t>]]></w:t></w:r> ';
    expect(xmlRoots(xml)).toEqual({ kind: "roots", roots: ["w:r"] });
  });

  test("an empty or comment-only fragment has no roots", () => {
    expect(xmlRoots("")).toEqual({ kind: "roots", roots: [] });
    expect(xmlRoots(" <!-- nothing --> ")).toEqual({ kind: "roots", roots: [] });
  });

  test.each([
    ["<w:r>", "<w:r> is never closed"],
    ["<w:r></w:t>", "</w:t> closes <w:r>"],
    ["</w:r>", "</w:r> closes nothing"],
    ["<w:r", 'the tag at offset 0 is never closed with ">"'],
    ['<w:r w:a="x>', 'the tag at offset 0 is never closed with ">"'],
    ["<!-- open", "<!-- is never closed"],
    ["text<w:r/>", 'text "text" stands outside an element'],
    ["<w:r/>tail", 'text "tail" stands outside an element'],
    ["<![CDATA[x]]>", "<![CDATA[ stands outside an element"],
    ["<!DOCTYPE x>", "declarations (<!…>) are not allowed"],
    ["< >", "the tag at offset 0 has no name"],
    ["<w:t>a & b</w:t>", 'a bare "&" in "a & b": write &amp;'],
    ['<w:sz w:val="a&b"/>', 'a bare "&" in "a&b": write &amp;'],
    ["<w:sz w:val=24/>", 'the attributes of <w:sz> are not name="value" pairs: w:val=24'],
    ["<w:b w:val/>", 'the attributes of <w:b> are not name="value" pairs: w:val'],
    ['<w:sz w:val="1" w:val="2"/>', "<w:sz> has the attribute w:val twice"],
    ["<w:t>&nbsp;</w:t>", "&nbsp; is not an XML entity: write a character reference such as &#160;"],
    ["<w:t>&#0;</w:t>", "&#0; is not a character XML allows"],
    ["<w:t>&#x110000;</w:t>", "&#x110000; is not a character XML allows"],
    ["<w:r><!-- a -- b --><w:t/></w:r>", "a comment holds --"],
  ])("%j is malformed: %s", (xml, reason) => {
    expect(xmlRoots(xml)).toEqual({ kind: "malformed", reason });
  });

  test("character and entity references are not bare ampersands", () => {
    expect(xmlRoots('<w:t a="&quot;">a &amp; b &lt;&gt;&apos; &#169; &#xA9;</w:t>')).toEqual({ kind: "roots", roots: ["w:t"] });
  });

  test("attributes may be single- or double-quoted and spaced around =", () => {
    expect(xmlRoots("<w:sz w:val = '24'\n w:x=\"1\" />")).toEqual({ kind: "roots", roots: ["w:sz"] });
  });

  test.each([
    ['<w:r><w:rPr/>x<w:t>a</w:t></w:r>', '<w:r> mixes text "x" with elements, and docx.js drops the element before the text'],
    ["<w:r><w:t>a</w:t>tail</w:r>", '<w:r> mixes text "tail" with elements, and docx.js drops the element before the text'],
    ["<w:r><![CDATA[x]]><w:t/></w:r>", '<w:r> mixes text "x" with elements, and docx.js drops the element before the text'],
    ["<w:r><w:t>a</w:t>\u00a0<w:tab/></w:r>", '<w:r> mixes text "\u00a0" with elements, and docx.js drops the element before the text'],
    ["<w:r><w:t>a</w:t>&#160;<w:tab/></w:r>", '<w:r> mixes text "&#160;" with elements, and docx.js drops the element before the text'],
    ["<w:r><w:t>a</w:t>\ufeff<w:tab/></w:r>", '<w:r> mixes text "\ufeff" with elements, and docx.js drops the element before the text'],
  ])("%j cannot be written: %s", (xml, reason) => {
    expect(xmlRoots(xml)).toEqual({ kind: "unwritable", reason });
  });

  test("XML whitespace between elements is indentation, not mixed content, written as text or a reference", () => {
    expect(xmlRoots("<w:r>\n  <w:rPr/>\n\t<w:t> a </w:t>\r\n</w:r>")).toEqual({ kind: "roots", roots: ["w:r"] });
    expect(xmlRoots("<w:r><w:rPr/>&#32;&#x9;<![CDATA[ ]]><w:t/></w:r>")).toEqual({ kind: "roots", roots: ["w:r"] });
  });
});

describe("13. RawXml fragment roots", () => {
  const raw = (xml: unknown) => n("RawXml", { xml });
  const rawPath = ["Document", "Section[0]", "Paragraph[0]", "RawXml[0]"];

  test("a RawXml in each of its slots stays a RawXml node with only its xml", () => {
    const tree = canon(
      doc(
        raw("<w:sdt/>"),
        n("Paragraph", {}, raw("<w:r/>"), n("TextRun", { bold: true }, "x", raw("<w:fldChar/>"))),
        n("Table", {}, n("TableRow", {}, n("TableCell", {}, raw("<w:tbl/>"), n("Paragraph"))))
      )
    );
    const rawNode = (xml: string) => ({ type: "RawXml", props: { xml }, children: [] });
    expect(blocks(tree)).toEqual([
      rawNode("<w:sdt/>"),
      paragraph({}, rawNode("<w:r/>"), run({ bold: true }, "x", rawNode("<w:fldChar/>"))),
      {
        type: "Table",
        props: {},
        children: [
          { type: "TableRow", props: {}, children: [{ type: "TableCell", props: {}, children: [rawNode("<w:tbl/>"), paragraph({})] }] },
        ],
      },
    ]);
  });

  test("a RawXml in a hyperlink, Bookmark, Header or ListItem takes that slot's roots", () => {
    expect(() =>
      canon(
        n(
          "Document",
          {},
          n(
            "Section",
            {},
            n("Header", {}, raw("<w:p/>")),
            n("Paragraph", {}, n("ExternalHyperlink", { link: "https://x.test" }, raw("<w:r/>")), n("Bookmark", { id: "b" }, raw("<w:r/>"))),
            n("List", {}, n("ListItem", {}, raw("<w:r/>")))
          )
        )
      )
    ).not.toThrow();
  });

  test.each([
    ["<w:p/>", "Paragraph", "RawXml <w:p> is not allowed in <Paragraph>"],
    ["<w:r/><w:p/>", "Paragraph", "RawXml <w:p> is not allowed in <Paragraph>"],
    ["<w:r/>", "Section", "RawXml <w:r> is not allowed in <Section>"],
    ["<w:footnoteReference w:id=\"1\"/>", "TextRun", "RawXml <w:footnoteReference> is not allowed in <TextRun>"],
  ])("%s in a %s throws", (xml, parent, message) => {
    const input =
      parent === "Section"
        ? doc(raw(xml))
        : parent === "Paragraph"
          ? doc(n("Paragraph", {}, raw(xml)))
          : doc(n("Paragraph", {}, n("TextRun", {}, raw(xml))));
    expect(treeError(() => canon(input)).message).toContain(message);
  });

  test("the error names the authored parent: a ListItem, not the Paragraph it becomes", () => {
    expect(() => canon(doc(n("List", {}, n("ListItem", {}, raw("<w:p/>")))))).toThrow(
      "RawXml <w:p> is not allowed in <ListItem>"
    );
  });

  test.each(["", "   ", "<!-- only a comment -->"])("the fragment %j throws: it holds no element", (xml) => {
    const error = treeError(() => canon(doc(n("Paragraph", {}, raw(xml)))));
    expect(error.path).toEqual(rawPath);
    expect(error.message).toContain("RawXml must contain at least one element");
  });

  test("a fragment that is only text throws: it holds no element", () => {
    expect(() => canon(doc(n("Paragraph", {}, raw("just text"))))).toThrow("RawXml must contain at least one element");
  });

  test("a fragment that mixes text and elements throws a TreeError with the RawXml's path", () => {
    const error = treeError(() => canon(doc(n("Paragraph", {}, raw("<w:r><w:t>x</w:t>junk<w:tab/></w:r>")))));
    expect(error.path).toEqual(rawPath);
    expect(error.message).toContain(
      'RawXml cannot be written: <w:r> mixes text "junk" with elements, and docx.js drops the element before the text'
    );
  });

  test("a bare & throws at the RawXml's path, before anything is written", () => {
    const error = treeError(() => canon(doc(n("Paragraph", {}, raw("<w:r><w:t>a & b</w:t></w:r>")))));
    expect(error.path).toEqual(rawPath);
    expect(error.message).toContain('RawXml is not well-formed: a bare "&" in "a & b": write &amp;');
  });

  test("an unbalanced fragment throws a TreeError with the RawXml's path", () => {
    const error = treeError(() => canon(doc(n("Paragraph", {}, raw("<w:r><w:t>a</w:r>")))));
    expect(error.path).toEqual(rawPath);
    expect(error.message).toContain("RawXml is not well-formed: </w:r> closes <w:t>");
  });

  test("xml that is not a string throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, raw(undefined))))).toThrow("RawXml xml must be a string, got undefined");
  });

  test("a RawXml with children throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("RawXml", { xml: "<w:r/>" }, n("TextRun")))))).toThrow(
      "<TextRun> is not allowed in <RawXml>"
    );
  });
});

describe("14. RawXml relationship references", () => {
  test.each(['r:id="rId1"', 'r:embed="rId5"', "r:link = 'rId2'"])("an attribute %s throws", (attribute) => {
    const xml = `<w:r><w:drawing><a:blip ${attribute}/></w:drawing></w:r>`;
    expect(() => canon(doc(n("Paragraph", {}, n("RawXml", { xml }))))).toThrow(
      "RawXml cannot carry relationship references (r:id, r:embed, …): docx.js cannot write their targets"
    );
  });

  test("r: in text or in another prefix's attribute name is not a relationship reference", () => {
    const xml = '<w:r w14:paraId="1"><w:t>for:id=1 r:id</w:t></w:r>';
    expect(() => canon(doc(n("Paragraph", {}, n("RawXml", { xml }))))).not.toThrow();
  });
});

describe("15. a TableCell ends with a Paragraph", () => {
  const cell = (...children: AuthorNode[]) => doc(n("Table", {}, n("TableRow", {}, n("TableCell", {}, ...children))));

  test("a TableCell whose last child is RawXml throws with the cell's path", () => {
    const error = treeError(() => canon(cell(n("Paragraph"), n("RawXml", { xml: "<w:p/>" }))));
    expect(error.path).toEqual(["Document", "Section[0]", "Table[0]", "TableRow[0]", "TableCell[0]"]);
    expect(error.message).toContain("A TableCell must end with a <Paragraph>");
  });

  test("a RawXml before the last Paragraph is fine", () => {
    expect(() => canon(cell(n("RawXml", { xml: "<w:p/>" }), n("Paragraph")))).not.toThrow();
  });
});

describe("16. styles.importedStyles", () => {
  const imported = (importedStyles: unknown, more: Record<string, unknown> = {}) =>
    canon(n("Document", { styles: { importedStyles, ...more } }, n("Section")));
  const style = (id: string) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/></w:style>`;

  test("XML strings with fresh style ids pass through unchanged", () => {
    const styles = [style("TableGrid"), `${style("Quote")}\n${style("Aside")}`];
    expect(imported(styles).props.styles).toEqual({ importedStyles: styles });
  });

  test.each([[[{ type: "component" }]], ["<w:style/>"]])("%j throws: it takes XML strings", (entries) => {
    expect(() => imported(entries)).toThrow("Document: styles.importedStyles takes XML strings");
  });

  test("a root other than w:style throws", () => {
    expect(() => imported([`${style("A")}<w:p/>`])).toThrow("styles.importedStyles[0] <w:p> is not allowed in styles.xml");
  });

  test("a relationship reference throws", () => {
    expect(() => imported(['<w:style w:styleId="A" r:id="rId1"/>'])).toThrow(
      "styles.importedStyles[0] cannot carry relationship references"
    );
  });

  test.each(["Heading1", "Title", "Hyperlink", "FootnoteTextChar"])("the id of docx.js's built-in %s throws", (id) => {
    expect(() => imported([style(id)])).toThrow(`styles.importedStyles[0] defines style "${id}", which is already defined`);
  });

  test("an id a paragraph or character style defines throws", () => {
    expect(() => imported([style("Quote")], { paragraphStyles: [{ id: "Quote" }] })).toThrow('defines style "Quote"');
    expect(() => imported([style("Mark")], { characterStyles: [{ id: "Mark" }] })).toThrow('defines style "Mark"');
  });

  test("an id an earlier imported style defines throws", () => {
    expect(() => imported([style("A"), style("B"), style("A")])).toThrow(
      'styles.importedStyles[2] defines style "A", which is already defined'
    );
  });
});

describe("17. loose content in Footnote, Comment and Textbox", () => {
  /** Each host where it may stand, and how to find its canonical children again. */
  const hosts = {
    Footnote: {
      tree: (...children: (AuthorNode | string)[]) => doc(n("Paragraph", {}, n("Footnote", {}, ...children))),
      children: (tree: DocumentNode) => (inline(tree) as { children: unknown }[])[0].children,
    },
    Comment: {
      tree: (...children: (AuthorNode | string)[]) =>
        n("Document", {}, n("Section"), n("Comment", { id: 0 }, ...children)),
      children: (tree: DocumentNode) => tree.children[1].children,
    },
    Textbox: {
      tree: (...children: (AuthorNode | string)[]) => doc(n("Textbox", { style: { width: "1in" } }, ...children)),
      children: (tree: DocumentNode) => (blocks(tree)[0] as { children: unknown }).children,
    },
  };

  test("<Footnote>text</Footnote> becomes Footnote > Paragraph > TextRun > text", () => {
    const tree = canon(doc(n("Paragraph", {}, "Claim", n("Footnote", {}, "Source: 2026 report"))));
    expect(inline(tree)).toEqual([
      run({}, "Claim"),
      { type: "Footnote", props: {}, children: [paragraph({}, run({}, "Source: 2026 report"))] },
    ]);
  });

  test.each(Object.keys(hosts) as (keyof typeof hosts)[])(
    "in a %s, each run of strings and inline content between blocks becomes one Paragraph",
    (host) => {
      const { tree, children } = hosts[host];
      const canonical = canon(tree("a", n("TextRun", { bold: true }, "b"), n("Paragraph", {}, "c"), n("Tab")));
      expect(children(canonical)).toEqual([
        paragraph({}, run({}, "a"), run({ bold: true }, "b")),
        paragraph({}, run({}, "c")),
        paragraph({}, run({}, tab)),
      ]);
    }
  );

  test("an error in wrapped content names its authored path, with no Paragraph in it", () => {
    const error = treeError(() => canon(hosts.Comment.tree("a", n("TextRun", {}, n("Section")))));
    expect(error.path).toEqual(["Document", "Comment[1]", "TextRun[1]", "Section[0]"]);
    expect(error.message).toContain("<Section> is not allowed in <TextRun>");
  });

  test("an empty Textbox holds one empty Paragraph, since w:txbxContent needs at least one block", () => {
    expect(hosts.Textbox.children(canon(hosts.Textbox.tree()))).toEqual([paragraph({})]);
  });

  test("a block kind the host does not hold still throws", () => {
    expect(() => canon(hosts.Textbox.tree(n("Table")))).toThrow("<Table> is not allowed in <Textbox>");
  });

  test("a Footnote must start with a Paragraph: docx.js puts the footnote's number there", () => {
    const table = n("Table", {}, n("TableRow", {}, n("TableCell", {}, n("Paragraph"))));
    const error = treeError(() => canon(hosts.Footnote.tree(table)));
    expect(error.path).toEqual(["Document", "Section[0]", "Paragraph[0]", "Footnote[0]"]);
    expect(error.message).toContain("A Footnote must start with a <Paragraph>");
    expect(() => canon(hosts.Footnote.tree())).toThrow("A Footnote must start with a <Paragraph>");
    expect(() => canon(hosts.Footnote.tree("note", table))).not.toThrow();
  });
});

describe("18. Footnote placement", () => {
  const footnote = () => n("Footnote", {}, "note");

  test.each(["Header", "Footer"])("a Footnote in a %s throws", (part) => {
    const error = treeError(() => canon(doc(n(part, {}, n("Paragraph", {}, footnote())))));
    expect(error.path).toEqual(["Document", "Section[0]", `${part}[0]`, "Paragraph[0]", "Footnote[0]"]);
    expect(error.message).toContain("Footnote is only allowed in the document body");
  });

  test("a Footnote in a Comment throws", () => {
    const tree = () => n("Document", {}, n("Section"), n("Comment", { id: 0 }, n("Paragraph", {}, footnote())));
    expect(() => canon(tree())).toThrow("Document > Comment[1] > Paragraph[0] > Footnote[0]: Footnote is only allowed");
  });

  test("a Footnote in a Footnote throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("Footnote", {}, "a", footnote()))))).toThrow(
      "Footnote is only allowed in the document body"
    );
  });

  test.each([
    ["a hyperlink", n("Paragraph", {}, n("ExternalHyperlink", { link: "https://x.test" }, footnote()))],
    ["a Bookmark", n("Paragraph", {}, n("Bookmark", { id: "b" }, footnote()))],
    ["a TableCell paragraph", n("Table", {}, n("TableRow", {}, n("TableCell", {}, n("Paragraph", {}, footnote()))))],
    ["a Textbox paragraph", n("Textbox", { style: { width: "1in" } }, n("Paragraph", {}, footnote()))],
  ])("a Footnote in %s of the body is fine", (_where, block) => {
    expect(() => canon(doc(block))).not.toThrow();
  });
});

describe("19. comment ids", () => {
  const withComments = (body: AuthorNode[], ...comments: AuthorNode[]) =>
    n("Document", {}, n("Section", {}, ...body), ...comments);
  const comment = (id: number) => n("Comment", { id, author: "Ada" }, "c");

  test("ranges and a reference resolve to a Comment that comes after them", () => {
    const marked = n(
      "Paragraph",
      {},
      n("CommentRangeStart", { id: 0 }),
      "x",
      n("CommentRangeEnd", { id: 0 }),
      n("CommentReference", { id: 0 })
    );
    const tree = canon(withComments([marked], comment(0)));
    expect(inline(tree)).toEqual([
      { type: "CommentRangeStart", props: { id: 0 }, children: [] },
      run({}, "x"),
      { type: "CommentRangeEnd", props: { id: 0 }, children: [] },
      run({}, { type: "CommentReference", props: { id: 0 }, children: [] }),
    ]);
  });

  test("a second Comment with the same id throws with its path", () => {
    const error = treeError(() => canon(withComments([], comment(0), comment(1), comment(0))));
    expect(error.path).toEqual(["Document", "Comment[3]"]);
    expect(error.message).toContain("A second <Comment id={0}>");
  });

  test.each(["CommentRangeStart", "CommentRangeEnd", "CommentReference"])("a %s with no matching Comment throws", (kind) => {
    const error = treeError(() => canon(withComments([n("Paragraph", {}, n(kind, { id: 1 }))], comment(0))));
    expect(error.path).toEqual(["Document", "Section[0]", "Paragraph[0]", `${kind}[0]`]);
    expect(error.message).toContain("No <Comment id={1}>");
  });

  test("a Comment no range or reference names is fine", () => {
    expect(() => canon(withComments([n("Paragraph", {}, "x")], comment(0)))).not.toThrow();
  });

  test("a Comment belongs to the Document, not a Section", () => {
    expect(() => canon(doc(comment(0)))).toThrow("<Comment> is not allowed in <Section>");
  });
});

describe("TableOfContents and Textbox are Section-body blocks", () => {
  test.each([
    ["TableOfContents", {}],
    ["Textbox", { style: { width: "1in" } }],
  ])("a %s in a Header or a TableCell throws", (kind, props) => {
    expect(() => canon(doc(n("Header", {}, n(kind, props))))).toThrow(`<${kind}> is not allowed in <Header>`);
    const cell = n("Table", {}, n("TableRow", {}, n("TableCell", {}, n(kind, props), n("Paragraph"))));
    expect(() => canon(doc(cell))).toThrow(`<${kind}> is not allowed in <TableCell>`);
  });
});

describe("lists", () => {
  const numbering = (reference: string, level: number, instance: number) => ({ numbering: { reference, level, instance } });

  test("a List expands into bullet paragraphs by default, at level 0 and instance 0", () => {
    const tree = canon(doc(n("List", {}, n("ListItem", {}, "a"), n("ListItem", {}, "b"))));
    expect(blocks(tree)).toEqual([
      paragraph(numbering("BulletList", 0, 0), run({}, "a")),
      paragraph(numbering("BulletList", 0, 0), run({}, "b")),
    ]);
  });

  test("two Lists get instances 0 and 1, so the second restarts", () => {
    const tree = canon(
      doc(n("List", { type: "numbered" }, n("ListItem", {}, "a")), n("Paragraph"), n("List", { type: "numbered" }, n("ListItem", {}, "b")))
    );
    expect(blocks(tree)).toEqual([
      paragraph(numbering("NumberedList", 0, 0), run({}, "a")),
      paragraph({}),
      paragraph(numbering("NumberedList", 0, 1), run({}, "b")),
    ]);
  });

  test("a List nested in a List is one level deeper with the same instance", () => {
    const tree = canon(doc(n("List", {}, n("ListItem", {}, "a"), n("List", {}, n("ListItem", {}, "a.1")), n("ListItem", {}, "b"))));
    expect(blocks(tree)).toEqual([
      paragraph(numbering("BulletList", 0, 0), run({}, "a")),
      paragraph(numbering("BulletList", 1, 0), run({}, "a.1")),
      paragraph(numbering("BulletList", 0, 0), run({}, "b")),
    ]);
  });

  test("a nested List of another type is a list of its own: a definition for its depth, at level 0 of a fresh instance", () => {
    const tree = canon(
      doc(
        n(
          "List",
          { type: "numbered" },
          n("ListItem", {}, "a", n("List", { type: "bullet" }, n("ListItem", {}, "a.1"))),
          n("List", {}, n("ListItem", {}, "a.2")),
          n("ListItem", {}, "b")
        ),
        n("List", { type: "numbered" }, n("ListItem", {}, "c"))
      )
    );
    expect(blocks(tree)).toEqual([
      paragraph(numbering("NumberedList", 0, 0), run({}, "a")),
      paragraph(numbering("BulletList@1", 0, 1), run({}, "a.1")),
      paragraph(numbering("BulletList@1", 0, 2), run({}, "a.2")),
      paragraph(numbering("NumberedList", 0, 0), run({}, "b")),
      paragraph(numbering("NumberedList", 0, 3), run({}, "c")),
    ]);
    const [, , nested] = (tree.props.numbering as typeof LIST_NUMBERING).config;
    expect(nested.reference).toBe("BulletList@1");
    expect(nested.levels.slice(0, 2)).toEqual([
      { level: 0, format: "bullet", text: "◦", alignment: "left", style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      { level: 1, format: "bullet", text: "▪", alignment: "left", style: { paragraph: { indent: { left: 2160, hanging: 360 } } } },
    ]);
    expect(nested.levels).toHaveLength(8);
  });

  test("a List of its parent's type below a switch continues that list one level deeper", () => {
    const tree = canon(
      doc(
        n(
          "List",
          { type: "bullet" },
          n("ListItem", {}, "a", n("List", { type: "numbered" }, n("ListItem", {}, "1", n("List", { type: "numbered" }, n("ListItem", {}, "1.a")))))
        )
      )
    );
    expect(blocks(tree)).toEqual([
      paragraph(numbering("BulletList", 0, 0), run({}, "a")),
      paragraph(numbering("NumberedList@1", 0, 1), run({}, "1")),
      paragraph(numbering("NumberedList@1", 1, 1), run({}, "1.a")),
    ]);
    const [, , nested] = (tree.props.numbering as typeof LIST_NUMBERING).config;
    expect(nested.levels.slice(0, 2).map((l) => [l.format, l.text])).toEqual([
      ["lowerLetter", "%1."],
      ["lowerRoman", "%2."],
    ]);
  });

  test("a List inside a ListItem splits the item: its paragraph first, then the nested items", () => {
    const tree = canon(
      doc(n("List", { type: "numbered" }, n("ListItem", {}, "a", n("List", { type: "numbered" }, n("ListItem", {}, "a.1")), " tail")))
    );
    expect(blocks(tree)).toEqual([
      paragraph(numbering("NumberedList", 0, 0), run({}, "a tail")),
      paragraph(numbering("NumberedList", 1, 0), run({}, "a.1")),
    ]);
  });

  test("a ListItem's text and heading apply to its paragraph", () => {
    const tree = canon(doc(n("List", {}, n("ListItem", { text: "a", heading: "Heading3" }, n("Tab")))));
    expect(blocks(tree)).toEqual([
      paragraph({ style: "Heading3", ...numbering("BulletList", 0, 0) }, run({}, "a"), run({}, tab)),
    ]);
  });

  test("a ListItem's text equal to a PageNumber value stays literal", () => {
    const tree = canon(doc(n("List", {}, n("ListItem", { text: "TOTAL_PAGES" }))));
    expect(blocks(tree)).toEqual([paragraph(numbering("BulletList", 0, 0), run({ text: "TOTAL_PAGES" }))]);
  });

  test("Lists expand in every block slot and share one instance counter", () => {
    const tree = canon(
      doc(
        n("Header", {}, n("List", {}, n("ListItem", {}, "h"))),
        n("Table", {}, n("TableRow", {}, n("TableCell", {}, n("List", {}, n("ListItem", {}, "c")))))
      )
    );
    const [header, table] = blocks(tree);
    expect(header).toMatchObject({ children: [paragraph(numbering("BulletList", 0, 0), run({}, "h"))] });
    expect(table).toMatchObject({
      children: [{ children: [{ children: [paragraph(numbering("BulletList", 0, 1), run({}, "c"))] }] }],
    });
  });

  test("Lists nest at most 9 deep, Word's level count, whatever their types", () => {
    const nest = (types: readonly string[]): AuthorNode =>
      n("List", { type: types[0] }, n("ListItem", {}, "x", ...(types.length > 1 ? [nest(types.slice(1))] : [])));
    const nine = Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? "bullet" : "numbered"));
    expect(() => canon(doc(nest(nine)))).not.toThrow();
    for (const tenth of ["bullet", "numbered"]) {
      expect(() => canon(doc(nest(["bullet", ...Array<string>(8).fill("bullet"), tenth])))).toThrow(
        "Lists nest at most 9 deep: Word numbers 9 levels"
      );
    }
  });

  test("List.level throws", () => {
    expect(() => canon(doc(n("List", { level: 1 }, n("ListItem", {}, "a"))))).toThrow(
      "Document > Section[0] > List[0]: List.level was removed; nest <List> instead"
    );
  });

  test("a ListItem outside a List is a plain Paragraph", () => {
    expect(blocks(canon(doc(n("ListItem", { alignment: "center" }, "a"))))).toEqual([
      paragraph({ alignment: "center" }, run({}, "a")),
    ]);
  });

  test("a List in a Paragraph throws", () => {
    expect(() => canon(doc(n("Paragraph", {}, n("List"))))).toThrow(
      "Document > Section[0] > Paragraph[0] > List[0]: <List> is not allowed in <Paragraph>"
    );
  });

  test("a List in a ListItem outside a List throws", () => {
    expect(() => canon(doc(n("ListItem", {}, "a", n("List"))))).toThrow(
      "Document > Section[0] > ListItem[0] > List[1]: <List> is not allowed in <ListItem>"
    );
  });

  test("a List holds only ListItems and Lists", () => {
    expect(() => canon(doc(n("List", {}, n("Paragraph"))))).toThrow(
      "Document > Section[0] > List[0] > Paragraph[0]: <Paragraph> is not allowed in <List>"
    );
    expect(() => canon(doc(n("List", {}, "a")))).toThrow("Document > Section[0] > List[0]: Text is not allowed directly in <List>");
  });

  test("an expanded List adds both LIST_NUMBERING configs to the Document", () => {
    const tree = canon(doc(n("List", {}, n("ListItem", {}, "a"))));
    expect(tree.props.numbering).toEqual(LIST_NUMBERING);
  });

  test("a user's own config for a reference is kept, and only the missing one is added", () => {
    const own = { reference: "NumberedList", levels: [{ level: 0, format: "upperRoman", text: "%1)" }] };
    const tree = canon(n("Document", { numbering: { config: [own] } }, n("Section", {}, n("List", { type: "numbered" }, n("ListItem", {}, "a")))));
    expect(tree.props.numbering).toEqual({ config: [own, LIST_NUMBERING.config[1]] });
  });

  test("a document without Lists gets no numbering config", () => {
    expect(canon(doc(n("Paragraph"))).props).toEqual({});
  });
});

describe("LIST_NUMBERING", () => {
  test("level 0 of each reference is 0.1.8's DEFAULT_NUMBERING, which DEFAULT_NUMBERING still exports", () => {
    const indent = { paragraph: { indent: { left: 720, hanging: 360 } } };
    const released = [
      { reference: "NumberedList", level0: { level: 0, format: "decimal", text: "%1.", alignment: "left", style: indent } },
      { reference: "BulletList", level0: { level: 0, format: "bullet", text: "•", alignment: "left", style: indent } },
    ];
    for (const numbering of [LIST_NUMBERING, DEFAULT_NUMBERING]) {
      expect(numbering.config.map((c) => ({ reference: c.reference, level0: c.levels[0] }))).toEqual(released);
    }
  });

  test("defines levels 0–8, indenting 720 twips per level", () => {
    for (const { levels } of LIST_NUMBERING.config) {
      expect(levels.map((l) => l.level)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(levels[8].style?.paragraph?.indent).toEqual({ left: 6480, hanging: 360 });
    }
  });

  test("numbered levels cycle decimal, lowerLetter, lowerRoman", () => {
    const [numbered] = LIST_NUMBERING.config;
    expect(numbered.levels.slice(0, 4).map((l) => [l.format, l.text])).toEqual([
      ["decimal", "%1."],
      ["lowerLetter", "%2."],
      ["lowerRoman", "%3."],
      ["decimal", "%4."],
    ]);
  });

  test("bullet levels cycle •, ◦, ▪", () => {
    const [, bullet] = LIST_NUMBERING.config;
    expect(bullet.levels.slice(0, 4).map((l) => [l.format, l.text])).toEqual([
      ["bullet", "•"],
      ["bullet", "◦"],
      ["bullet", "▪"],
      ["bullet", "•"],
    ]);
  });
});

describe("canonicalize as a whole", () => {
  const everything = () =>
    n(
      "Document",
      { styles: { paragraphStyles: [{ id: "Title", name: "Title" }] } },
      n(
        "Section",
        { properties: { titlePage: true } },
        n("Header", {}, n("Paragraph", {}, n("TextRun", {}, "Page ", "CURRENT"))),
        n("Paragraph", { heading: "Heading1", text: "Title" }, "x", n("Break"), n("Tab")),
        n("List", { type: "numbered" }, n("ListItem", {}, "a", n("List", {}, n("ListItem", {}, "b")))),
        n("Paragraph", {}, n("TextRun", { bold: true }, "a", n("Break"), "b"), n("Math", { text: "x" })),
        n("Paragraph", { text: "SECTION" }, "CURRENT", n("TextRun", { text: "" }, "TOTAL_", "PAGES")),
        n("Table", {}, n("TableRow", {}, n("TableCell", {}, n("Paragraph", {}, "cell"))))
      )
    );

  test("is idempotent: canonicalize(canonicalize(x)) equals canonicalize(x)", () => {
    const once = canonicalize(everything());
    expect(canonicalize(once)).toEqual(once);
  });

  test("is pure: the input is unchanged", () => {
    const input = everything();
    const before = structuredClone(input);
    canonicalize(input);
    expect(input).toEqual(before);
  });
});
