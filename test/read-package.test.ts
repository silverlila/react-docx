import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { renderToBuffer } from "../src/index";
import { NotADocxError, openPackage } from "../src/read/package";
import { attrOf, childNamed, isOn, parseXml, serializeXml, textOf } from "../src/ooxml/xml";
import { CASES } from "./support/cases";
import { PICTURE, docx, part } from "./support/docx-fixture";
import { parseXmlFragment } from "./support/xml-fragment";

const IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const HEADER = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="MS Mincho"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

describe("parseXml and serializeXml", () => {
  test("reproduce unindented XML exactly, decoding entities in text and escaping them again", () => {
    const xml = '<w:p><w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r></w:p>';
    const parsed = parseXml(xml);
    expect(textOf(parsed)).toBe(" a & b ");
    expect(serializeXml(parsed)).toBe(xml);
  });

  test("round trip an attribute holding a quote and an ampersand", () => {
    const xml = '<w:x w:val="say &quot;hi&quot; &amp; go"/>';
    const parsed = parseXml(xml);
    expect(attrOf(parsed, "w:val")).toBe('say "hi" & go');
    expect(serializeXml(parsed)).toBe(xml);
  });

  test("skip the XML declaration and comments, and write CDATA as escaped text", () => {
    const parsed = parseXml('<?xml version="1.0"?><w:t>a<!-- note --><![CDATA[<b> & c]]></w:t>');
    expect(parsed).toEqual({ name: "w:t", attributes: {}, children: ["a<b> & c"] });
    expect(serializeXml(parsed)).toBe("<w:t>a&lt;b&gt; &amp; c</w:t>");
  });

  test("parseXmlFragment returns each sibling element", () => {
    const elements = parseXmlFragment('<w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText>');
    expect(elements.map((el) => el.name)).toEqual(["w:fldChar", "w:instrText"]);
    expect(textOf(elements[1])).toBe(" PAGE ");
  });

  test("parseXml throws when the text holds no element", () => {
    expect(() => parseXml("just text")).toThrow(/no element/);
  });

  test("isOn reads OOXML on/off properties", () => {
    const rPr = parseXml('<w:rPr><w:b/><w:i w:val="0"/><w:strike w:val="false"/><w:caps w:val="1"/></w:rPr>');
    expect(["w:b", "w:i", "w:strike", "w:caps", "w:u"].map((name) => isOn(childNamed(rPr, name)))).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});

describe("openPackage", () => {
  test("finds the main document part through the package relationships", () => {
    const pkg = openPackage(docx({ body: "<w:p/>" }));
    expect(pkg.mainPart).toBe("word/document.xml");
    expect(pkg.part(pkg.mainPart)?.name).toBe("w:document");
  });

  test("finds a main part stored somewhere other than word/document.xml", () => {
    const bytes = docx({
      body: "<w:p/>",
      parts: {
        "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/main.xml"/></Relationships>`,
        "word/main.xml": part("w:document", "<w:body><w:p/></w:body>"),
      },
    });
    expect(openPackage(bytes).mainPart).toBe("word/main.xml");
  });

  test("resolves an image relationship to its media path and returns the bytes", () => {
    const pkg = openPackage(
      docx({
        body: "<w:p/>",
        rels: `<Relationship Id="rId1" Type="${IMAGE}" Target="media/image1.png"/>`,
        media: { "word/media/image1.png": PICTURE },
      })
    );
    const rel = pkg.relsOf("word/document.xml").get("rId1");
    expect(rel).toEqual({ type: IMAGE, target: "word/media/image1.png", external: false });
    expect(pkg.media("word/media/image1.png")).toEqual(PICTURE);
    expect(pkg.media("word/media/missing.png")).toBeNull();
  });

  test("resolves a header part's relationships against the header's own folder", () => {
    const pkg = openPackage(
      docx({
        body: "<w:p/>",
        rels: `<Relationship Id="rId7" Type="${HEADER}" Target="header1.xml"/>`,
        parts: {
          "word/header1.xml": part("w:hdr", "<w:p/>"),
          "word/_rels/header1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${IMAGE}" Target="media/image2.png"/><Relationship Id="rId2" Type="${IMAGE}" Target="../media/./top.png"/><Relationship Id="rId3" Type="${IMAGE}" Target="/word/x.png"/></Relationships>`,
        },
      })
    );
    const header = pkg.relsOf("word/document.xml").get("rId7")?.target;
    expect(header).toBe("word/header1.xml");
    expect(pkg.part("word/header1.xml")?.name).toBe("w:hdr");
    const targets = [...pkg.relsOf("word/header1.xml").values()].map((rel) => rel.target);
    expect(targets).toEqual(["word/media/image2.png", "media/top.png", "word/x.png"]);
  });

  test("keeps an external hyperlink target verbatim", () => {
    const pkg = openPackage(
      docx({
        body: "<w:p/>",
        rels: `<Relationship Id="rId9" Type="${HYPERLINK}" Target="https://example.com/a/../b?x=1&amp;y=2" TargetMode="External"/>`,
      })
    );
    expect(pkg.relsOf("word/document.xml").get("rId9")).toEqual({
      type: HYPERLINK,
      target: "https://example.com/a/../b?x=1&y=2",
      external: true,
    });
  });

  test("reads theme fonts and colours, taking a system colour's last colour", () => {
    const pkg = openPackage(docx({ body: "<w:p/>", theme: THEME }));
    expect(pkg.theme.fonts).toEqual({
      major: { latin: "Calibri Light", eastAsia: null, complex: null },
      minor: { latin: "Calibri", eastAsia: "MS Mincho", complex: "Arial" },
    });
    expect(pkg.theme.colors).toEqual({
      dk1: "000000",
      lt1: "FFFFFF",
      dk2: "44546A",
      accent1: "4472C4",
      hlink: "0563C1",
    });
  });

  test("reads the core properties", () => {
    const pkg = openPackage(
      docx({ body: "<w:p/>", core: "<dc:title>My &amp; Resume</dc:title><dc:creator>Ada</dc:creator><cp:revision>3</cp:revision>" })
    );
    expect(pkg.core).toEqual({ title: "My & Resume", creator: "Ada", revision: 3 });
  });

  test("lists every file entry, and reports which paths exist", () => {
    const pkg = openPackage(docx({ body: "<w:p/>", media: { "word/media/image1.png": PICTURE } }));
    expect([...pkg.paths].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/media/image1.png",
    ]);
    expect(pkg.media("word/media/image1.png")).toEqual(PICTURE);
    expect(pkg.media("word/styles.xml")).toBeNull();
    expect(pkg.part("word/styles.xml")).toBeNull();
  });
});

describe("openPackage on a file docx.js wrote", () => {
  test("finds its parts, no directory entries, an empty theme and docx.js's core properties", async () => {
    const pkg = openPackage(await renderToBuffer(CASES[0].element));
    expect(pkg.mainPart).toBe("word/document.xml");
    expect(pkg.paths.length).toBeGreaterThanOrEqual(10);
    expect(pkg.paths.filter((path) => path.endsWith("/"))).toEqual([]);
    expect(pkg.part("word/styles.xml")?.name).toBe("w:styles");
    expect(pkg.theme).toEqual({
      fonts: {
        major: { latin: null, eastAsia: null, complex: null },
        minor: { latin: null, eastAsia: null, complex: null },
      },
      colors: {},
    });
    expect(pkg.core).toEqual({ creator: "Un-named", lastModifiedBy: "Un-named", revision: 1 });
  });
});

describe("NotADocxError", () => {
  const DOCUMENT = { "word/document.xml": strToU8(part("w:document", "<w:body/>")) };

  test("for bytes that are not a zip", () => {
    expect(() => openPackage(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(NotADocxError);
  });

  test("for a zip without [Content_Types].xml", () => {
    expect(() => openPackage(zipSync(DOCUMENT))).toThrow(NotADocxError);
  });

  test("for a zip without a main document", () => {
    const bytes = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/styles.xml": strToU8("<w:styles/>") });
    expect(() => openPackage(bytes)).toThrow(NotADocxError);
  });
});
