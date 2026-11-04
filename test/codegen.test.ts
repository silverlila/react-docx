/** vitest caches modules by URL, so each printed module is written to its own folder under
 *  test/.generated/. vitest fails a suite with no tests, so the real-file suite is skipped, not left empty,
 *  when there are no real files. */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { beforeAll, describe, expect, test } from "vitest";
import { printJsx, type GeneratedModule } from "../src/codegen/index";
import { Document, ImageRun, Paragraph, Section, renderToBuffer, renderToTree } from "../src/index";
import { readDocx } from "../src/read/index";
import { canonicalize } from "../src/tree/canonical";
import type { DocumentNode } from "../src/schema/elements";
import { WORD_SHAPED } from "./fixtures/word-shaped";
import { CASES, PNG_1PX } from "./support/cases";
import { n } from "./support/nodes";

const GENERATED = join(__dirname, ".generated");
const REAL = join(__dirname, "fixtures", "real");

beforeAll(() => rmSync(GENERATED, { recursive: true, force: true }));

async function rendered(folder: string, printed: GeneratedModule): Promise<DocumentNode> {
  const dir = join(GENERATED, folder);
  const file = join(dir, "Doc.tsx");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, printed.source);
  for (const asset of printed.assets) {
    mkdirSync(dirname(join(dir, asset.path)), { recursive: true });
    writeFileSync(join(dir, asset.path), asset.bytes);
  }
  const mod: { default: () => null } = await import(pathToFileURL(file).href);
  return renderToTree(createElement(mod.default));
}

async function roundTrips(folder: string, tree: DocumentNode): Promise<void> {
  expect(await rendered(folder, printJsx(tree, { componentName: "Doc" }))).toEqual(tree);
}

const doc = (...children: Parameters<typeof n>[2][]) => canonicalize(n("Document", {}, n("Section", {}, ...children)));
const paragraph = (...children: Parameters<typeof n>[2][]) => doc(n("Paragraph", {}, ...children));

function realFiles(): { name: string; bytes: Uint8Array }[] {
  if (!existsSync(REAL)) return [];
  return readdirSync(REAL)
    .filter((name) => name.endsWith(".docx"))
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(REAL, name))) }));
}

describe("a printed module renders the tree it was printed from", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("phase-1 case %s, read back", async (name, { element }) => {
    await roundTrips(`case-${name}`, readDocx(new Uint8Array(await renderToBuffer(element))).document);
  });

  test.each(WORD_SHAPED.map((f) => [f.name, f] as const))("Word-shaped %s", async (name, { bytes }) => {
    await roundTrips(`word-${name}`, readDocx(bytes).document);
  });
});

const REAL_FILES = realFiles();
const REAL_FILE_TIMEOUT_MS = 30_000;

describe.skipIf(REAL_FILES.length === 0)("a printed real file renders the tree it was printed from", () => {
  test.each(REAL_FILES.map((f, i) => [f.name, i, f] as const))(
    "%s",
    async (_name, i, { bytes }) => {
      await roundTrips(`real-${i}`, readDocx(bytes).document);
    },
    REAL_FILE_TIMEOUT_MS,
  );
});

describe("printing rules", () => {
  test("a string with outer spaces prints as a string expression and keeps them", async () => {
    const tree = paragraph(n("TextRun", {}, " a "));
    expect(printJsx(tree).source).toContain('<TextRun>{" a "}</TextRun>');
    await roundTrips("rule-spaces", tree);
  });

  test("plain text prints as JSX text", () => {
    expect(printJsx(paragraph(n("TextRun", {}, "Hello, world"))).source).toContain("<TextRun>Hello, world</TextRun>");
  });

  test.each([
    ["a brace", "a {b}"],
    ["an ampersand", "Q&amp;A"],
    ["a tag", "<b>"],
    ["a newline", "a\nb"],
    ["a tab", "a\tb"],
  ])("text with %s round trips", async (label, value) => {
    const tree = paragraph(n("TextRun", {}, value));
    expect(printJsx(tree).source).toContain(`<TextRun>{${JSON.stringify(value)}}</TextRun>`);
    await roundTrips(`rule-text-${label.replace(/ /g, "-")}`, tree);
  });

  test("a true boolean prints as a bare attribute", () => {
    expect(printJsx(paragraph(n("TextRun", { bold: true }, "x"))).source).toContain("<TextRun bold>x</TextRun>");
  });

  test("a false boolean prints as an expression", () => {
    expect(printJsx(paragraph(n("TextRun", { bold: false }, "x"))).source).toContain(
      "<TextRun bold={false}>x</TextRun>",
    );
  });

  test.each([
    ["a quote", 'say "hi"'],
    ["a backslash", "a\\b"],
    ["an ampersand", "https://example.com/?a=1&amp=2"],
  ])("an attribute string with %s prints as an expression and round trips", async (label, link) => {
    const tree = paragraph(n("ExternalHyperlink", { link }, n("TextRun", {}, "x")));
    expect(printJsx(tree).source).toContain(`link={${JSON.stringify(link)}}`);
    await roundTrips(`rule-attribute-${label.replace(/ /g, "-")}`, tree);
  });

  test("a plain attribute string prints in quotes", () => {
    const tree = doc(n("Paragraph", { style: "Heading1" }, n("TextRun", {}, "Title")));
    expect(printJsx(tree).source).toContain('<Paragraph style="Heading1"><TextRun>Title</TextRun></Paragraph>');
  });

  test("a Date prints as new Date with its ISO string", () => {
    const tree = canonicalize(n("Document", { created: new Date("2026-01-01T00:00:00.000Z") }, n("Section")));
    expect(printJsx(tree).source).toContain('created={new Date("2026-01-01T00:00:00.000Z")}');
  });

  test("RawXml with a backtick and ${x} prints as an escaped template literal and round trips", async () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve">a `b` ${x} \\n</w:t></w:r></w:p>';
    const tree = doc(n("RawXml", { xml }));
    expect(printJsx(tree).source).toContain(
      '<RawXml xml={`<w:p><w:r><w:t xml:space="preserve">a \\`b\\` \\${x} \\\\n</w:t></w:r></w:p>`} />',
    );
    await roundTrips("rule-raw-xml", tree);
  });

  test("object props print as literals with identifier keys bare and others quoted", () => {
    const tree = paragraph(n("TextRun", { font: { ascii: "Arial", "x-y": "z" } }, "x"));
    expect(printJsx(tree).source).toContain('<TextRun font={{ ascii: "Arial", "x-y": "z" }}>x</TextRun>');
  });

  test("a value too wide for 100 columns breaks onto indented lines", () => {
    const font = { ascii: "A very long font family name", hAnsi: "Another very long font family name", cs: "Third" };
    const source = printJsx(paragraph(n("TextRun", { font, bold: true }, "x"))).source;
    expect(source).toContain(
      [
        "          <TextRun",
        "            font={{",
        '              ascii: "A very long font family name",',
        '              hAnsi: "Another very long font family name",',
        '              cs: "Third",',
        "            }}",
        "            bold",
        "          >",
        "            x",
        "          </TextRun>",
      ].join("\n"),
    );
    for (const line of source.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
  });

  test("styles and numbering are hoisted to consts and referenced by name", () => {
    const styles = { paragraphStyles: [{ id: "MyStyle", name: "My Style", run: { bold: true } }] };
    const tree = canonicalize(
      n("Document", { title: "T", styles }, n("Section", {}, n("Paragraph", { style: "MyStyle" }))),
    );
    const { source } = printJsx(tree);
    expect(source).toContain(
      'const styles = { paragraphStyles: [{ id: "MyStyle", name: "My Style", run: { bold: true } }] };',
    );
    expect(source).toContain('<Document title="T" styles={styles}>');
    expect(source).not.toContain("const numbering");
  });

  test("Header and Footer print their default type", () => {
    const tree = canonicalize(n("Document", {}, n("Section", {}, n("Header", {}, n("Paragraph")))));
    expect(printJsx(tree).source).toContain('<Header type="default"><Paragraph /></Header>');
  });

  test("two ImageRuns with the same bytes share one asset", async () => {
    const image = () => n("ImageRun", { type: "png", data: PNG_1PX.slice(), transformation: { width: 1, height: 1 } });
    const tree = paragraph(image(), image());
    const printed = printJsx(tree);
    expect(printed.assets.map((asset) => asset.path)).toEqual(["assets/image1.png"]);
    expect(printed.assets[0].bytes).toEqual(PNG_1PX);
    expect(
      printed.source.match(/readFileSync\(new URL\("\.\/assets\/image1\.png", import\.meta\.url\)\)/g),
    ).toHaveLength(2);
    await roundTrips("rule-shared-asset", tree);
  });

  test("an SVG and its raster fallback are separate assets, numbered in document order", () => {
    const svg = new TextEncoder().encode("<svg/>");
    const tree = paragraph(
      n("ImageRun", {
        type: "svg",
        data: svg,
        fallback: { type: "png", data: PNG_1PX },
        transformation: { width: 1, height: 1 },
      }),
    );
    expect(printJsx(tree).assets.map((asset) => asset.path)).toEqual(["assets/image1.svg", "assets/image2.png"]);
  });

  test("a raster ImageRun given a fallback through a spread prints it as an asset and round trips", async () => {
    const fallback = new TextEncoder().encode("fallback");
    const image = {
      type: "png" as const,
      data: PNG_1PX,
      fallback: { type: "png" as const, data: fallback },
      transformation: { width: 1, height: 1 },
    };
    const tree = renderToTree(
      createElement(
        Document,
        null,
        createElement(Section, null, createElement(Paragraph, null, createElement(ImageRun, image))),
      ),
    );
    const printed = printJsx(tree);
    expect(printed.assets).toEqual([
      { path: "assets/image1.png", bytes: PNG_1PX },
      { path: "assets/image2.png", bytes: fallback },
    ]);
    await roundTrips("rule-raster-fallback", tree);
  });

  test("a literal text prop equal to a PageNumber value stays literal text", async () => {
    const tree = paragraph(n("TextRun", { text: "CURRENT" }, "x"));
    expect(tree.children[0].children[0].children).toEqual([
      { type: "TextRun", props: { text: "CURRENT" }, children: [] },
      { type: "TextRun", props: {}, children: ["x"] },
    ]);
    expect(printJsx(tree).source).toContain('<TextRun text="CURRENT" />');
    await roundTrips("rule-literal-sentinel", tree);
  });

  test("a PageNumber prints as its docx.PageNumber key", async () => {
    const tree = paragraph(n("TextRun", {}, "Page ", "CURRENT", " of ", "SECTION"));
    expect(printJsx(tree).source).toContain(
      '<TextRun>{"Page "}{PageNumber.CURRENT}{" of "}{PageNumber.CURRENT_SECTION}</TextRun>',
    );
    await roundTrips("rule-page-number", tree);
  });

  test("imports list only the kinds used, sorted, and PageNumber only when used", () => {
    const plain = printJsx(paragraph(n("TextRun", {}, "x"))).source;
    expect(plain.split("\n\n")[0]).toBe('import { Document, Paragraph, Section, TextRun } from "@react-docx/core";');

    const numbered = printJsx(paragraph(n("TextRun", {}, "CURRENT")), { importFrom: "react-docx" }).source;
    expect(numbered.split("\n\n")[0]).toBe(
      [
        'import { PageNumber } from "docx";',
        'import { Document, Paragraph, Section, TextRun } from "react-docx";',
      ].join("\n"),
    );
  });

  test("the module exports the component by name and as default", () => {
    const source = printJsx(paragraph(), { componentName: "Resume" }).source;
    expect(source).toContain("export function Resume() {\n  return (\n    <Document>");
    expect(source.endsWith("export default Resume;\n")).toBe(true);
  });

  test("a component name that is taken by an import throws", () => {
    expect(() => printJsx(paragraph(), { componentName: "Paragraph" })).toThrow(/already a name/);
  });
});
