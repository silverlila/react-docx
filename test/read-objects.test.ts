import { TextWrappingType, type IImageOptions } from "docx";
import { strToU8 } from "fflate";
import { createElement as h } from "react";
import { describe, expect, test } from "vitest";
import { Document, ImageRun, Paragraph, Section, renderToBuffer, renderToTree } from "../src/index";
import { readDocx, type Diagnostic } from "../src/read/index";
import { CASES, PNG_1PX } from "./support/cases";
import { PICTURE, docx, type FixtureParts } from "./support/docx-fixture";
import { imageRunXml } from "./support/docx-props";

type TreeNode = { readonly type: string; readonly props: Record<string, unknown>; readonly children: readonly (TreeNode | string)[] };

const IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PICTURE_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const CHART_URI = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

const tree = (value: unknown): TreeNode => value as TreeNode;
const read = (parts: FixtureParts) => readDocx(docx(parts));
const blocksOf = (parts: FixtureParts) => tree(read(parts).document).children.map(tree)[0].children.map(tree);

const node = (type: string, props: Record<string, unknown> = {}, children: readonly (TreeNode | string)[] = []): TreeNode => ({
  type,
  props,
  children,
});
const text = (t: string) => node("TextRun", {}, [t]);

function findAll(root: TreeNode, type: string): TreeNode[] {
  const own = root.type === type ? [root] : [];
  return [...own, ...root.children.flatMap((child) => (typeof child === "string" ? [] : findAll(child, type)))];
}

const located = (diagnostics: readonly Diagnostic[], kind: string, element: string) =>
  diagnostics.filter((d) => d.kind === kind && d.element === element);

const diagnostic = (kind: string, element: string, detail: string) =>
  expect.objectContaining({ kind, element, detail: expect.stringContaining(detail) });

/** A one-picture package: the body plus rId5 → word/media/<name>. */
const withMedia = (body: string, name = "image1.png", bytes: Uint8Array = PICTURE): FixtureParts => ({
  body,
  rels: `<Relationship Id="rId5" Type="${IMAGE}" Target="media/${name}"/>`,
  media: { [`word/media/${name}`]: bytes },
});

const graphic = (uri: string, inside: string) => `<a:graphic><a:graphicData uri="${uri}">${inside}</a:graphicData></a:graphic>`;
const pic = (blipFill = "") =>
  graphic(
    PICTURE_URI,
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="photo.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="rId5"/>${blipFill}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
  );
const chart = graphic(CHART_URI, '<c:chart r:id="rId9"/>');
/** An inline drawing of 952500 × 476250 EMU, which is 100 × 50 px. */
const inlineDrawing = (inside: string) =>
  `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Picture 1"/>${inside}</wp:inline></w:drawing>`;
const vmlPicture = '<w:pict><v:shape id="p1" style="width:72pt;height:36pt"><v:imagedata r:id="rId5"/></v:shape></w:pict>';
const textBox = (inside: string) =>
  `<w:pict><v:shape id="b1" type="#_x0000_t202" style="width:200pt;height:50pt"><v:textbox><w:txbxContent>${inside}</w:txbxContent></v:textbox></v:shape></w:pict>`;
const p = (inside: string, pPr = "") => `<w:p>${pPr}${inside}</w:p>`;
const r = (inside: string) => `<w:r>${inside}</w:r>`;
const run = (t: string) => r(`<w:t>${t}</w:t>`);

describe("DrawingML pictures: docx.js's output reads back to options it writes the same", () => {
  const samples: [string, IImageOptions][] = [
    ["inline", { type: "png", data: PNG_1PX, transformation: { width: 120, height: 80 } }],
    ["rotated and flipped", { type: "png", data: PNG_1PX, transformation: { width: 120, height: 80, rotation: 90, flip: { horizontal: true } } }],
    ["alt text", { type: "png", data: PNG_1PX, transformation: { width: 120, height: 80 }, altText: { name: "photo", description: "Ada", title: "t" } }],
    [
      "floating",
      {
        type: "png",
        data: PNG_1PX,
        transformation: { width: 120, height: 80 },
        floating: {
          horizontalPosition: { relative: "page", offset: 914400 },
          verticalPosition: { relative: "paragraph", align: "top" },
          wrap: { type: TextWrappingType.SQUARE, side: "bothSides" },
          margins: { top: 0, bottom: 0, left: 114300, right: 114300 },
          behindDocument: false,
          allowOverlap: true,
        },
      },
    ],
    ["svg with a png fallback", { type: "svg", data: SVG, fallback: { type: "png", data: PNG_1PX }, transformation: { width: 120, height: 80 } }],
    ["outlined", { type: "png", data: PNG_1PX, transformation: { width: 120, height: 80 }, outline: { type: "solidFill", solidFillType: "rgb", value: "FF0000", width: 12700 } }],
  ];

  test.each(samples)("%s", async (_name, sample) => {
    const written = await renderToBuffer(h(Document, null, h(Section, null, h(Paragraph, null, h(ImageRun, sample)))));
    const [image] = findAll(tree(readDocx(written).document), "ImageRun");
    const expected = await imageRunXml(sample);
    expect(expected).toContain("<w:drawing>");
    expect(await imageRunXml(image.props as IImageOptions)).toBe(expected);
  });

  test("a picture docx.js wrote reads with no diagnostic about the picture", async () => {
    const [, sample] = samples[3];
    const written = await renderToBuffer(h(Document, null, h(Section, null, h(Paragraph, null, h(ImageRun, sample)))));
    const located = readDocx(written).diagnostics.filter((d) => d.kind !== "ignored" && d.at !== null);
    expect(located).toEqual([]);
  });
});

describe("DrawingML pictures from Word", () => {
  test("an inline picture becomes an ImageRun with its bytes, px size and alt text name", () => {
    const [paragraph] = blocksOf(withMedia(p(r(inlineDrawing(pic())))));
    expect(paragraph.children).toEqual([
      node("ImageRun", { type: "png", data: PICTURE, transformation: { width: 100, height: 50 }, altText: { name: "Picture 1" } }),
    ]);
  });

  test("a picture splits its run, and the run's properties stay with its text only", () => {
    const parts = withMedia(p(r(`<w:rPr><w:b/></w:rPr><w:t>a</w:t>${inlineDrawing(pic())}<w:t>b</w:t>`)));
    const [paragraph] = blocksOf(parts);
    expect(paragraph.children.map((child) => tree(child).type)).toEqual(["TextRun", "ImageRun", "TextRun"]);
    expect(tree(paragraph.children[0]).props).toEqual({ bold: true });
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "w:rPr", "run without properties"));
  });

  test("a cropped picture comes back uncropped, with a dropped note", () => {
    const parts = withMedia(p(r(inlineDrawing(pic('<a:srcRect l="10000"/>')))));
    expect(findAll(blocksOf(parts)[0], "ImageRun")).toHaveLength(1);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "a:srcRect", "crop is not expressible; image kept uncropped"));
  });

  test("an .emf picture is dropped", () => {
    const parts = withMedia(p(r(inlineDrawing(pic()))), "image1.emf");
    expect(blocksOf(parts)[0]).toEqual(node("Paragraph"));
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "a:blip", "word/media/image1.emf"));
  });

  test("a chart is dropped, never RawXml", () => {
    const parts = withMedia(p(r(inlineDrawing(chart))));
    expect(blocksOf(parts)[0]).toEqual(node("Paragraph"));
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "w:drawing", `${CHART_URI} is not a picture`));
  });

  test("a chart in mc:AlternateContent with a VML picture fallback becomes that picture", () => {
    const alternate = `<mc:AlternateContent><mc:Choice Requires="c14">${inlineDrawing(chart)}</mc:Choice><mc:Fallback>${vmlPicture}</mc:Fallback></mc:AlternateContent>`;
    const parts = withMedia(p(r(alternate)));
    expect(blocksOf(parts)[0].children).toEqual([node("ImageRun", { type: "png", data: PICTURE, transformation: { width: 96, height: 48 } })]);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("resolved", "mc:AlternateContent", "used Fallback"));
  });

  test("a picture in mc:AlternateContent's Choice is used", () => {
    const alternate = `<mc:AlternateContent><mc:Choice Requires="wps">${inlineDrawing(pic())}</mc:Choice><mc:Fallback>${vmlPicture}</mc:Fallback></mc:AlternateContent>`;
    const parts = withMedia(p(r(alternate)));
    expect(findAll(blocksOf(parts)[0], "ImageRun").map((image) => image.props.transformation)).toEqual([{ width: 100, height: 50 }]);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("resolved", "mc:AlternateContent", "used Choice"));
  });

  test("mc:AlternateContent whose Choice does not map and which has no Fallback is dropped", () => {
    const parts = withMedia(p(r(`<mc:AlternateContent><mc:Choice Requires="c14">${inlineDrawing(chart)}</mc:Choice></mc:AlternateContent>`)));
    expect(blocksOf(parts)[0]).toEqual(node("Paragraph"));
    expect(located(read(parts).diagnostics, "dropped", "mc:AlternateContent")).toHaveLength(1);
  });

  test("an anchored picture becomes floating, with offsets in EMU and Word 2010 attributes dropped", () => {
    const anchor =
      '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" wp14:anchorId="1A2B3C4D">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>-635000</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV><wp:extent cx="952500" cy="476250"/>' +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="largest"/><wp:docPr id="1" name=""/>${pic()}</wp:anchor></w:drawing>`;
    const parts = withMedia(p(r(anchor)));
    const [image] = findAll(blocksOf(parts)[0], "ImageRun");
    expect(image.props.floating).toEqual({
      horizontalPosition: { relative: "column", offset: -635000 },
      verticalPosition: { relative: "paragraph", align: "top" },
      behindDocument: true,
      margins: { top: 0, bottom: 0, left: 114300, right: 114300 },
      zIndex: 251658240,
      wrap: { type: TextWrappingType.SQUARE, side: "largest" },
    });
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "wp:anchor", "wp14:anchorId"));
  });

  test("wp:wrapThrough is dropped", () => {
    const anchor =
      '<w:drawing><wp:anchor simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      `<wp:extent cx="952500" cy="476250"/><wp:wrapThrough wrapText="bothSides"/><wp:docPr id="1" name=""/>${pic()}</wp:anchor></w:drawing>`;
    const parts = withMedia(p(r(anchor)));
    expect(findAll(blocksOf(parts)[0], "ImageRun")[0].props.floating).not.toHaveProperty("wrap");
    expect(located(read(parts).diagnostics, "dropped", "wp:wrapThrough")).toHaveLength(1);
  });
});

describe("VML", () => {
  test("a VML picture becomes an ImageRun sized in px from pt, with a resolved note", () => {
    const parts = withMedia(p(r(vmlPicture)));
    expect(blocksOf(parts)[0].children).toEqual([node("ImageRun", { type: "png", data: PICTURE, transformation: { width: 96, height: 48 } })]);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("resolved", "w:pict", "VML image converted to DrawingML"));
  });

  test("a text box alone in its paragraph becomes a Textbox with the shape's style and its paragraphs", () => {
    expect(blocksOf({ body: p(r(textBox(p(run("in box"))))) })).toEqual([
      node("Textbox", { style: { width: "200pt", height: "50pt" } }, [node("Paragraph", {}, [text("in box")])]),
    ]);
  });

  test("Word's text box, a wps shape with a VML fallback alone in its run, becomes a Textbox", () => {
    const wps = inlineDrawing(graphic("http://schemas.microsoft.com/office/word/2010/wordprocessingShape", "<wps:wsp/>"));
    const alternate = `<mc:AlternateContent><mc:Choice Requires="wps">${wps}</mc:Choice><mc:Fallback>${textBox(p(run("x")))}</mc:Fallback></mc:AlternateContent>`;
    const parts: FixtureParts = { body: p(r(alternate)) };
    expect(blocksOf(parts).map((block) => block.type)).toEqual(["Textbox"]);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("resolved", "mc:AlternateContent", "used Fallback"));
  });

  test("a text box sharing its paragraph becomes a Textbox before the paragraph, and the result writes", async () => {
    const parts: FixtureParts = { body: p(run("before") + r(textBox(p(run("x"))))) };
    const [box, paragraph] = blocksOf(parts);
    expect(box.type).toBe("Textbox");
    expect(findAll(box, "TextRun").map((r) => r.children)).toEqual([["x"]]);
    expect(paragraph).toEqual(node("Paragraph", {}, [text("before")]));
    expect(read(parts).diagnostics).toContainEqual(diagnostic("resolved", "w:pict", "read as a Textbox before its paragraph"));
    const again = readDocx(new Uint8Array(await renderToBuffer(read(parts).document)));
    expect(findAll(again.document as never, "Textbox")).toHaveLength(1);
  });

  test("each hoisted text box reports at its own path", () => {
    const parts: FixtureParts = { body: p(run("before") + r(textBox(p(run("x")))) + r(textBox(p(run("y"))))) };
    const at = read(parts)
      .diagnostics.filter((d) => d.kind === "resolved" && d.element === "w:pict")
      .map((d) => ("at" in d ? d.at : null));
    expect(at).toEqual([[0, 0], [0, 1]]);
  });

  test("a text box in a table cell is dropped: Textbox stands only in a Section body", () => {
    const parts: FixtureParts = { body: `<w:tbl><w:tr><w:tc>${p(r(textBox(p(run("x")))))}</w:tc></w:tr></w:tbl>` };
    expect(findAll(blocksOf(parts)[0], "Textbox")).toEqual([]);
    expect(read(parts).diagnostics).toContainEqual(diagnostic("dropped", "w:pict", "Textbox stands only in a Section"));
  });

  test("a table in a text box is dropped with its cells, and the result writes", async () => {
    const table = `<w:tbl><w:tr><w:tc>${p(run("cell"))}</w:tc></w:tr></w:tbl>`;
    const result = read({ body: p(r(textBox(p(run("kept")) + table))) });
    const [box] = tree(result.document).children.map(tree)[0].children.map(tree);
    expect(box).toEqual(node("Textbox", { style: { width: "200pt", height: "50pt" } }, [node("Paragraph", {}, [text("kept")])]));
    expect(result.diagnostics).toContainEqual(diagnostic("dropped", "w:tbl", "table in a text box"));
    await expect(renderToBuffer(result.document)).resolves.toBeInstanceOf(Uint8Array);
  });

  test("an empty text box reads as a Textbox holding one empty Paragraph", () => {
    expect(blocksOf({ body: p(r(textBox(""))) })).toEqual([node("Textbox", { style: { width: "200pt", height: "50pt" } }, [node("Paragraph")])]);
  });

  test("a text box paragraph's heading style becomes heading; any other style is dropped", () => {
    const styled = (style: string) => ({ body: p(r(textBox(p(run("x")))), `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`) });
    expect(blocksOf(styled("Heading2"))[0].props).toEqual({ heading: "Heading2", style: { width: "200pt", height: "50pt" } });
    expect(blocksOf(styled("MyStyle"))[0].props).toEqual({ style: { width: "200pt", height: "50pt" } });
    expect(read(styled("MyStyle")).diagnostics).toContainEqual(diagnostic("dropped", "w:pStyle", '"MyStyle"'));
  });

  test("a style declaration VmlShapeStyle has no value for is dropped", () => {
    const box = '<w:pict><v:shape id="b1" style="width:100px;height:50pt;mso-fit-shape-to-text:t"><v:textbox><w:txbxContent/></v:textbox></v:shape></w:pict>';
    const parts: FixtureParts = { body: p(r(box)) };
    expect(blocksOf(parts)[0].props).toEqual({ style: { height: "50pt" } });
    expect(located(read(parts).diagnostics, "dropped", "v:shape").map((d) => (d.kind === "ignored" ? "" : d.detail))).toEqual([
      "style width:100px: docx.js's text box style has no value for it",
      "style mso-fit-shape-to-text:t: docx.js's text box style has no value for it",
    ]);
  });

  test("w:object (an OLE object) is dropped", () => {
    const object = '<w:object><v:shape id="o1" style="width:72pt;height:36pt"><v:imagedata r:id="rId5"/></v:shape><o:OLEObject r:id="rId6"/></w:object>';
    const parts = withMedia(p(r(object)));
    expect(blocksOf(parts)[0]).toEqual(node("Paragraph"));
    expect(located(read(parts).diagnostics, "dropped", "w:object")).toHaveLength(1);
  });
});

describe("math", () => {
  test("plain m:oMath becomes Math with one MathRun per m:r, and run properties are dropped", () => {
    const math = '<m:oMath><m:r><m:t>x</m:t></m:r><m:r><w:rPr><w:rFonts w:ascii="Cambria Math"/></w:rPr><m:t>+1</m:t></m:r></m:oMath>';
    const parts: FixtureParts = { body: p(math) };
    expect(blocksOf(parts)[0].children).toEqual([node("Math", {}, [node("MathRun", {}, ["x"]), node("MathRun", {}, ["+1"])])]);
    expect(located(read(parts).diagnostics, "dropped", "w:rPr")).toHaveLength(1);
  });

  test("m:oMath with a fraction stays inline RawXml", () => {
    const math = "<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath>";
    const parts: FixtureParts = { body: p(math) };
    expect(blocksOf(parts)[0].children).toEqual([node("RawXml", { xml: math })]);
    expect(located(read(parts).diagnostics, "raw", "m:oMath")).toHaveLength(1);
  });

  test("m:oMathPara stays inline RawXml", () => {
    const math = "<m:oMathPara><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></m:oMathPara>";
    expect(blocksOf({ body: p(math) })[0].children).toEqual([node("RawXml", { xml: math })]);
  });
});

describe("phase-1 cases", () => {
  const caseNamed = (name: string) => {
    const found = CASES.find((c) => c.name === name);
    if (found === undefined) throw new Error(`no phase-1 case ${name}`);
    return found.element;
  };

  test("image reads back to the ImageRun props and bytes renderToTree gives", async () => {
    const element = caseNamed("image");
    const actual = tree(readDocx(await renderToBuffer(element)).document);
    expect(findAll(actual, "ImageRun")).toEqual(findAll(tree(renderToTree(element)), "ImageRun"));
  });

  test("bug-math-text reads back to the Math structure renderToTree gives", async () => {
    const element = caseNamed("bug-math-text");
    const actual = tree(readDocx(await renderToBuffer(element)).document);
    const expected = findAll(tree(renderToTree(element)), "Math");
    expect(expected).toHaveLength(1);
    expect(findAll(actual, "Math")).toEqual(expected);
  });
});
