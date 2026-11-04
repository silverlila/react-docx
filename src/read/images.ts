/** DrawingML w:drawing and VML v:imagedata pictures → ImageRun.
 *
 *  - docx.js writes every picture with the same boilerplate (wp:cNvGraphicFramePr, pic:nvPicPr, a:stretch,
 *    an empty a:srcRect, a rect a:prstGeom, a:noFill, the blip's cstate, a zero wp:simplePos, the
 *    wp:effectExtent it computes).
 *  - Size is px × 9525 EMU; floating offsets are in EMU. A VML length without a unit is px (96 dpi).
 *  - `<a:ln><a:noFill/></a:ln>` draws no line, the same as docx.js's picture without an outline.
 *  - a:xfrm rot is in 60000ths of a degree. docx.js writes rotation × 60000 unrounded, so about 6% of whole
 *    angles come out as float noise (31905 → rot="31904.999999999996").
 *  - docx.js needs an align or an offset on wp:positionH/V, and writes an image's run without properties. */

import type * as docx from "docx";
import { DECIMAL, INTEGER, NO_OPTION, dropped, isOneOf, isOnValue, resolved, type Note } from "../ooxml/codec";
import type { RunOptions } from "../ooxml/run";
import type { ImageProps } from "../schema/elements";
import { isOwnKey } from "../schema/own";
import type { AuthorNode } from "../tree/author";
import type { ReadContext } from "./context";
import { styleDeclarations } from "./objects";
import { attrOf, childNamed, elementsOf, textOf, type XmlElement } from "../ooxml/xml";

type ValueOf<T> = T[keyof T];
type Raster = { readonly type: "jpg" | "png" | "gif" | "bmp"; readonly data: Uint8Array };
type Picture = Raster | { readonly type: "svg"; readonly data: Uint8Array; readonly fallback: Raster };
type Transformation = docx.IImageOptions["transformation"];
type Floating = NonNullable<docx.IImageOptions["floating"]>;
type AltText = NonNullable<docx.IImageOptions["altText"]>;
type Outline = NonNullable<docx.IImageOptions["outline"]>;
type Position<R, A> = { readonly relative?: R; readonly align?: A; readonly offset?: number };

type DrawingRead =
  | {
      readonly kind: "image";
      readonly props: ImageProps;
      readonly media: readonly string[];
      readonly notes: readonly Note[];
    }
  | { readonly kind: "refused"; readonly notes: readonly Note[] };

const PICTURE_URI = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const EMU_PER_PX = 9525;
const ROTATION_UNIT = 60000;
const DEFAULT_OUTLINE_WIDTH = 9525;
const CROP = "crop is not expressible; image kept uncropped";
const VML_LENGTH = /^(-?[0-9]+(?:\.[0-9]+)?)(pt|in|cm|mm|pc|px)?$/;

const RASTER_TYPES: Readonly<Record<string, Raster["type"]>> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  bmp: "bmp",
};
const PX_PER_UNIT: Readonly<Record<string, number>> = {
  pt: 96 / 72,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pc: 16,
  px: 1,
};

const HORIZONTAL_FROM = [
  "character",
  "column",
  "insideMargin",
  "leftMargin",
  "margin",
  "outsideMargin",
  "page",
  "rightMargin",
] as const satisfies readonly ValueOf<typeof docx.HorizontalPositionRelativeFrom>[];
const HORIZONTAL_ALIGN = ["center", "inside", "left", "outside", "right"] as const satisfies readonly ValueOf<
  typeof docx.HorizontalPositionAlign
>[];
const VERTICAL_FROM = [
  "bottomMargin",
  "insideMargin",
  "line",
  "margin",
  "outsideMargin",
  "page",
  "paragraph",
  "topMargin",
] as const satisfies readonly ValueOf<typeof docx.VerticalPositionRelativeFrom>[];
const VERTICAL_ALIGN = ["bottom", "center", "inside", "outside", "top"] as const satisfies readonly ValueOf<
  typeof docx.VerticalPositionAlign
>[];
const WRAP_SIDES = ["bothSides", "left", "right", "largest"] as const satisfies readonly ValueOf<
  typeof docx.TextWrappingSide
>[];
const WRAP_TYPES = {
  "wp:wrapNone": 0,
  "wp:wrapSquare": 1,
  "wp:wrapTight": 2,
  "wp:wrapTopAndBottom": 3,
} as const satisfies Readonly<Record<string, ValueOf<typeof docx.TextWrappingType>>>;

const ANCHOR_FLAGS = [
  ["allowOverlap", "allowOverlap", true],
  ["behindDoc", "behindDocument", false],
  ["locked", "lockAnchor", false],
  ["layoutInCell", "layoutInCell", true],
] as const;
const MARGINS = [
  ["distT", "top"],
  ["distB", "bottom"],
  ["distL", "left"],
  ["distR", "right"],
] as const;
const ANCHOR_ATTRIBUTES = new Set<string>([
  "simplePos",
  "relativeHeight",
  ...ANCHOR_FLAGS.map(([name]) => name),
  ...MARGINS.map(([name]) => name),
]);

const INLINE_PARTS = ["wp:extent", "wp:effectExtent", "wp:docPr", "wp:cNvGraphicFramePr", "a:graphic"];
const CONTAINER_PARTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "wp:inline": new Set(INLINE_PARTS),
  "wp:anchor": new Set([...INLINE_PARTS, "wp:simplePos", "wp:positionH", "wp:positionV", ...Object.keys(WRAP_TYPES)]),
};
const PIC_PARTS = new Set(["pic:nvPicPr", "pic:blipFill", "pic:spPr"]);
const BLIP_FILL_PARTS = new Set(["a:blip", "a:stretch", "a:srcRect"]);
const DOC_PR_ATTRIBUTES = new Set(["id", "name", "descr", "title"]);

const refused = (notes: readonly Note[], note: Note): DrawingRead => ({ kind: "refused", notes: [...notes, note] });

function wholeAt(el: XmlElement | null, name: string): number | null {
  const value = attrOf(el, name);
  return value !== null && INTEGER.test(value) ? Number(value) : null;
}

function mediaOf(
  relId: string | null,
  element: string,
  ctx: ReadContext,
  notes: Note[],
  media: string[],
): { path: string; data: Uint8Array } | null {
  if (relId === null) {
    notes.push(dropped(element, "the picture is not embedded (a linked file), which docx.js cannot write"));
    return null;
  }
  const rel = ctx.pkg.relsOf(ctx.part).get(relId);
  if (rel === undefined || rel.external) {
    notes.push(dropped(element, `r:embed="${relId}" names no part in the package`));
    return null;
  }
  const data = ctx.pkg.media(rel.target);
  if (data === null) {
    notes.push(dropped(element, `${rel.target} is missing from the package`));
    return null;
  }
  media.push(rel.target);
  return { path: rel.target, data };
}

function rasterOf(
  relId: string | null,
  element: string,
  ctx: ReadContext,
  notes: Note[],
  media: string[],
): Raster | null {
  const part = mediaOf(relId, element, ctx, notes, media);
  if (part === null) return null;
  const extension = part.path.slice(part.path.lastIndexOf(".") + 1).toLowerCase();
  if (!isOwnKey(RASTER_TYPES, extension)) {
    notes.push(dropped(element, `${part.path}: docx.js writes only png, jpg, gif and bmp pictures`));
    return null;
  }
  return { type: RASTER_TYPES[extension], data: part.data };
}

function pictureOf(blipFill: XmlElement | null, ctx: ReadContext, notes: Note[], media: string[]): Picture | null {
  for (const child of elementsOf(blipFill)) {
    if (!BLIP_FILL_PARTS.has(child.name)) notes.push(dropped(child.name, NO_OPTION));
    else if (child.name === "a:srcRect" && Object.values(child.attributes).some((value) => value !== "0"))
      notes.push(dropped(child.name, CROP));
  }
  const blip = childNamed(blipFill, "a:blip");
  let svg: { data: Uint8Array } | null = null;
  for (const child of elementsOf(blip)) {
    if (child.name !== "a:extLst") {
      notes.push(dropped(child.name, "a picture effect docx.js cannot write"));
      continue;
    }
    for (const ext of elementsOf(child)) {
      const svgBlip = childNamed(ext, "asvg:svgBlip");
      if (svgBlip === null) notes.push(dropped(ext.name, `${attrOf(ext, "uri") ?? "(no uri)"}: ${NO_OPTION}`));
      else svg = mediaOf(attrOf(svgBlip, "r:embed"), svgBlip.name, ctx, notes, media);
    }
  }
  const raster = rasterOf(attrOf(blip, "r:embed"), "a:blip", ctx, notes, media);
  if (raster === null) return null;
  return svg === null ? raster : { type: "svg", data: svg.data, fallback: raster };
}

function outlineOf(ln: XmlElement, notes: Note[]): Outline | null {
  const [only, ...others] = elementsOf(ln);
  if (only?.name === "a:noFill" && others.length === 0) return null;
  const fill = childNamed(ln, "a:solidFill");
  const rgb = childNamed(fill, "a:srgbClr");
  const value = attrOf(rgb, "val");
  if (value === null || elementsOf(fill).length !== 1 || elementsOf(rgb).length > 0) {
    notes.push(dropped(ln.name, "only a solid RGB outline is expressible in docx.js"));
    return null;
  }
  for (const child of elementsOf(ln)) if (child !== fill) notes.push(dropped(child.name, NO_OPTION));
  for (const [name, attribute] of Object.entries(ln.attributes)) {
    if (name !== "w" || !INTEGER.test(attribute)) notes.push(dropped(ln.name, `${name}="${attribute}": ${NO_OPTION}`));
  }
  const width = wholeAt(ln, "w");
  return { ...(width === null ? {} : { width }), type: "solidFill", solidFillType: "rgb", value };
}

type Shape = { readonly flip?: Transformation["flip"]; readonly rotation?: number; readonly outline?: Outline };

function rotationOf(xfrm: XmlElement, notes: Note[]): number | null {
  const rot = attrOf(xfrm, "rot");
  if (rot === null) return null;
  if (!DECIMAL.test(rot)) {
    notes.push(dropped(xfrm.name, `rot="${rot}" is not an angle`));
    return null;
  }
  return Math.round(Number(rot));
}

function shapeOf(spPr: XmlElement | null, notes: Note[]): Shape {
  let shape: Shape = {};
  for (const child of elementsOf(spPr)) {
    switch (child.name) {
      case "a:xfrm": {
        const rot = rotationOf(child, notes);
        const horizontal = isOnValue(attrOf(child, "flipH") ?? "0");
        const vertical = isOnValue(attrOf(child, "flipV") ?? "0");
        const flip = { ...(horizontal ? { horizontal } : {}), ...(vertical ? { vertical } : {}) };
        if (Object.keys(flip).length > 0) shape = { ...shape, flip };
        if (rot !== null && rot !== 0) shape = { ...shape, rotation: rot / ROTATION_UNIT };
        break;
      }
      case "a:prstGeom": {
        const preset = attrOf(child, "prst");
        if (preset !== "rect") notes.push(dropped(child.name, `prst="${preset}": docx.js writes a rectangle`));
        break;
      }
      case "a:noFill":
        break;
      case "a:ln": {
        const outline = outlineOf(child, notes);
        if (outline !== null) shape = { ...shape, outline };
        break;
      }
      default:
        notes.push(dropped(child.name, NO_OPTION));
    }
  }
  return shape;
}

function altTextOf(docPr: XmlElement | null, notes: Note[]): AltText | undefined {
  for (const name of Object.keys(docPr?.attributes ?? {})) {
    if (!DOC_PR_ATTRIBUTES.has(name)) notes.push(dropped("wp:docPr", `${name}: ${NO_OPTION}`));
  }
  for (const child of elementsOf(docPr)) notes.push(dropped(child.name, NO_OPTION));
  const name = attrOf(docPr, "name");
  const description = attrOf(docPr, "descr");
  const title = attrOf(docPr, "title");
  if ([name, description, title].every((value) => value === null || value === "")) return undefined;
  return { name: name ?? "", ...(description === null ? {} : { description }), ...(title === null ? {} : { title }) };
}

function positionOf<R extends string, A extends string>(
  el: XmlElement | null,
  from: readonly R[],
  aligns: readonly A[],
  notes: Note[],
): Position<R, A> {
  const name = el?.name ?? "wp:positionH/V";
  const relativeFrom = attrOf(el, "relativeFrom");
  let relative: R | undefined;
  if (relativeFrom !== null && isOneOf(from, relativeFrom)) relative = relativeFrom;
  else if (relativeFrom !== null)
    notes.push(dropped(name, `relativeFrom="${relativeFrom}" is not a value docx.js accepts`));
  const at = relative === undefined ? {} : { relative };
  const align = childNamed(el, "wp:align");
  const offset = childNamed(el, "wp:posOffset");
  for (const child of elementsOf(el))
    if (child !== align && child !== offset) notes.push(dropped(child.name, NO_OPTION));
  const alignText = align === null ? null : textOf(align);
  if (alignText !== null && isOneOf(aligns, alignText)) return { ...at, align: alignText };
  const offsetText = offset === null ? null : textOf(offset);
  if (offsetText !== null && INTEGER.test(offsetText)) return { ...at, offset: Number(offsetText) };
  notes.push(dropped(name, "no align or offset docx.js accepts; written at offset 0"));
  return { ...at, offset: 0 };
}

function wrapOf(anchor: XmlElement, notes: Note[]): Floating["wrap"] | undefined {
  for (const el of elementsOf(anchor)) {
    if (el.name === "wp:wrapSquare") {
      const side = attrOf(el, "wrapText");
      if (side !== null && !isOneOf(WRAP_SIDES, side))
        notes.push(dropped(el.name, `wrapText="${side}" is not a value docx.js accepts`));
      return side !== null && isOneOf(WRAP_SIDES, side)
        ? { type: WRAP_TYPES[el.name], side }
        : { type: WRAP_TYPES[el.name] };
    }
    if (el.name === "wp:wrapTight") {
      const side = attrOf(el, "wrapText");
      if (side !== null) notes.push(dropped(el.name, `wrapText="${side}": docx.js writes a tight wrap without a side`));
      for (const child of elementsOf(el)) notes.push(dropped(child.name, NO_OPTION));
      return { type: WRAP_TYPES[el.name] };
    }
    if (el.name === "wp:wrapNone" || el.name === "wp:wrapTopAndBottom") return { type: WRAP_TYPES[el.name] };
  }
  return undefined;
}

function floatingOf(anchor: XmlElement, height: number, notes: Note[]): Floating {
  const options: { -readonly [K in keyof Floating]?: Floating[K] } = {};
  for (const [attribute, key, fallback] of ANCHOR_FLAGS) {
    const value = attrOf(anchor, attribute);
    if (value !== null && isOnValue(value) !== fallback) options[key] = isOnValue(value);
  }
  const margins = Object.fromEntries(MARGINS.map(([attribute, key]) => [key, wholeAt(anchor, attribute) ?? 0]));
  if (Object.values(margins).some((value) => value !== 0)) options.margins = margins;
  const relativeHeight = wholeAt(anchor, "relativeHeight");
  if (relativeHeight === 0)
    notes.push(dropped("wp:anchor", 'relativeHeight="0": docx.js writes the picture height instead'));
  else if (relativeHeight !== null && relativeHeight !== height) options.zIndex = relativeHeight;
  if (isOnValue(attrOf(anchor, "simplePos") ?? "0"))
    notes.push(dropped("wp:anchor", 'simplePos="1": docx.js positions by wp:positionH and wp:positionV only'));
  const wrap = wrapOf(anchor, notes);
  if (wrap !== undefined) options.wrap = wrap;
  return {
    horizontalPosition: positionOf(childNamed(anchor, "wp:positionH"), HORIZONTAL_FROM, HORIZONTAL_ALIGN, notes),
    verticalPosition: positionOf(childNamed(anchor, "wp:positionV"), VERTICAL_FROM, VERTICAL_ALIGN, notes),
    ...options,
  };
}

function checkContainer(container: XmlElement, outline: Outline | undefined, notes: Note[]): void {
  const inline = container.name === "wp:inline";
  for (const [name, value] of Object.entries(container.attributes)) {
    if (inline && name.startsWith("dist")) {
      if (value !== "0") notes.push(dropped(container.name, `${name}="${value}": docx.js writes 0`));
    } else if (inline || !ANCHOR_ATTRIBUTES.has(name)) {
      notes.push(dropped(container.name, `${name}: ${NO_OPTION}`));
    }
  }
  const parts = CONTAINER_PARTS[container.name];
  for (const child of elementsOf(container)) {
    if (!parts.has(child.name)) notes.push(dropped(child.name, NO_OPTION));
  }
  const effect = childNamed(container, "wp:effectExtent");
  const expected = inline && outline !== undefined ? String(2 * (outline.width ?? DEFAULT_OUTLINE_WIDTH)) : "0";
  if (effect !== null && ["l", "t", "r", "b"].some((side) => attrOf(effect, side) !== expected)) {
    notes.push(dropped(effect.name, "docx.js writes its own effect extent"));
  }
}

export function parseDrawing(drawing: XmlElement, ctx: ReadContext): DrawingRead {
  const notes: Note[] = [];
  const [container, ...rest] = elementsOf(drawing);
  if (container === undefined || !isOwnKey(CONTAINER_PARTS, container.name) || rest.length > 0) {
    return refused(notes, dropped(drawing.name, "it holds no single wp:inline or wp:anchor"));
  }
  const graphicData = childNamed(childNamed(container, "a:graphic"), "a:graphicData");
  const uri = attrOf(graphicData, "uri");
  if (uri !== PICTURE_URI) return refused(notes, dropped(drawing.name, `${uri ?? "(no uri)"} is not a picture`));
  const extent = childNamed(container, "wp:extent");
  const cx = wholeAt(extent, "cx");
  const cy = wholeAt(extent, "cy");
  if (cx === null || cy === null) return refused(notes, dropped(drawing.name, "the picture has no wp:extent size"));
  const pic = childNamed(graphicData, "pic:pic");
  for (const child of elementsOf(pic)) if (!PIC_PARTS.has(child.name)) notes.push(dropped(child.name, NO_OPTION));
  const media: string[] = [];
  const picture = pictureOf(childNamed(pic, "pic:blipFill"), ctx, notes, media);
  if (picture === null) return { kind: "refused", notes };
  const { outline, ...transform } = shapeOf(childNamed(pic, "pic:spPr"), notes);
  checkContainer(container, outline, notes);
  const transformation = { width: Math.round(cx / EMU_PER_PX), height: Math.round(cy / EMU_PER_PX), ...transform };
  const floating = container.name === "wp:anchor" ? floatingOf(container, cy, notes) : undefined;
  const altText = altTextOf(childNamed(container, "wp:docPr"), notes);
  const props: ImageProps = {
    ...picture,
    transformation,
    ...(floating === undefined ? {} : { floating }),
    ...(altText === undefined ? {} : { altText }),
    ...(outline === undefined ? {} : { outline }),
  };
  return { kind: "image", props, media, notes };
}

function vmlPx(value: string | undefined): number | null {
  const match = VML_LENGTH.exec(value ?? "");
  return match === null ? null : Math.round(Number(match[1]) * PX_PER_UNIT[match[2] ?? "px"]);
}

export function parseVmlImage(pict: XmlElement, ctx: ReadContext): DrawingRead | null {
  const shape = childNamed(pict, "v:shape");
  const imagedata = childNamed(shape, "v:imagedata");
  if (imagedata === null) return null;
  const notes: Note[] = [];
  const style = new Map(styleDeclarations(attrOf(shape, "style") ?? ""));
  const width = vmlPx(style.get("width"));
  const height = vmlPx(style.get("height"));
  if (width === null || height === null) {
    return refused(notes, dropped("v:shape", "its style gives no width and height in pt, in, cm, mm, pc or px"));
  }
  const media: string[] = [];
  const raster = rasterOf(attrOf(imagedata, "r:id"), imagedata.name, ctx, notes, media);
  if (raster === null) return { kind: "refused", notes };
  return {
    kind: "image",
    props: { ...raster, transformation: { width, height } },
    media,
    notes: [resolved("w:pict", "VML image converted to DrawingML"), ...notes],
  };
}

export function readPicture(read: DrawingRead, runProps: RunOptions, ctx: ReadContext): AuthorNode | null {
  ctx.notes(read.notes);
  if (read.kind === "refused") return null;
  for (const path of read.media) ctx.consume(path);
  if (Object.keys(runProps).length > 0) {
    ctx.report({ kind: "dropped", element: "w:rPr", detail: "docx.js writes a picture's run without properties" });
  }
  return { type: "ImageRun", props: read.props, children: [] };
}
