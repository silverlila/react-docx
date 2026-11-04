/** A text box is a w:pict whose v:shape holds v:textbox/w:txbxContent. docx.js writes its own shape id,
 *  shape type #_x0000_t202 and v:textbox attributes on a text box. */

import type * as docx from "docx";
import { DECIMAL, INTEGER, NO_OPTION, dropped, type Note } from "../ooxml/codec";
import { VML_MEASURE, VML_POSITION, VML_POSITIONS, VML_RELATIVE_TO } from "../schema/docx-facts";
import { own } from "../schema/own";
import { attrOf, childNamed, childrenNamed, elementsOf, type XmlElement } from "../ooxml/xml";

type ShapeStyle = NonNullable<ConstructorParameters<typeof docx.Textbox>[0]["style"]>;
type ShapeStyleRead = { -readonly [K in keyof ShapeStyle]?: ShapeStyle[K] };
type Length = ShapeStyle["width"];
type StyleReader<K extends keyof ShapeStyle> = (value: string) => NonNullable<ShapeStyle[K]> | null;
type StyleEntry = { [K in keyof ShapeStyle]-?: readonly [K, StyleReader<K>] }[keyof ShapeStyle];

export type TextBox = {
  readonly shape: XmlElement;
  readonly content: XmlElement;
};

type Alternate = { readonly used: "Choice" | "Fallback"; readonly elements: readonly XmlElement[] };

const DOCX_SHAPE_TYPE = "#_x0000_t202";
const DOCX_TEXTBOX_ATTRIBUTES: Readonly<Record<string, string>> = {
  style: "mso-fit-shape-to-text:t;",
  insetmode: "auto",
};

const isMeasure = (value: string): value is Exclude<Length, "auto" | number> => VML_MEASURE.test(value);
const length = (value: string): Length | null =>
  value === "auto" || isMeasure(value) ? value : DECIMAL.test(value) ? Number(value) : null;
const number = (value: string): number | null => (DECIMAL.test(value) ? Number(value) : null);
const oneOf =
  <const V extends string>(values: readonly V[]) =>
  (value: string): V | null =>
    values.find((known) => known === value) ?? null;
const flag = (value: string): boolean | null => (value === "t" || value === "true" ? true : value === "f" || value === "false" ? false : null);
const zIndex = (value: string): "auto" | number | null => (value === "auto" ? value : INTEGER.test(value) ? Number(value) : null);

const POSITIONS = oneOf(VML_POSITIONS);
const RELATIVE_TO = oneOf(VML_RELATIVE_TO);

const SHAPE_STYLE: Readonly<Record<string, StyleEntry>> = {
  flip: ["flip", oneOf(["x", "y", "xy", "yx"])],
  height: ["height", length],
  left: ["left", length],
  "margin-bottom": ["marginBottom", length],
  "margin-left": ["marginLeft", length],
  "margin-right": ["marginRight", length],
  "margin-top": ["marginTop", length],
  "mso-position-horizontal": ["positionHorizontal", POSITIONS],
  "mso-position-horizontal-relative": ["positionHorizontalRelative", RELATIVE_TO],
  "mso-position-vertical": ["positionVertical", POSITIONS],
  "mso-position-vertical-relative": ["positionVerticalRelative", RELATIVE_TO],
  "mso-wrap-distance-bottom": ["wrapDistanceBottom", number],
  "mso-wrap-distance-left": ["wrapDistanceLeft", number],
  "mso-wrap-distance-right": ["wrapDistanceRight", number],
  "mso-wrap-distance-top": ["wrapDistanceTop", number],
  "mso-wrap-edited": ["wrapEdited", flag],
  "mso-wrap-style": ["wrapStyle", oneOf(["square", "none"])],
  position: ["position", oneOf(VML_POSITION)],
  rotation: ["rotation", number],
  top: ["top", length],
  visibility: ["visibility", oneOf(["hidden", "inherit"])],
  width: ["width", length],
  "z-index": ["zIndex", zIndex],
};

export function styleDeclarations(style: string): [string, string][] {
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "")
    .map((declaration): [string, string] => {
      const colon = declaration.indexOf(":");
      return colon < 0 ? [declaration, ""] : [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    });
}

export function textBoxOf(pict: XmlElement): TextBox | null {
  const shape = childNamed(pict, "v:shape");
  const content = childNamed(childNamed(shape, "v:textbox"), "w:txbxContent");
  return shape === null || content === null ? null : { shape, content };
}

export function textBoxStyle(box: TextBox, notes: Note[]): Readonly<ShapeStyleRead> | undefined {
  const { shape } = box;
  for (const [name, value] of Object.entries(shape.attributes)) {
    if (name === "id" || name === "style" || (name === "type" && value === DOCX_SHAPE_TYPE)) continue;
    notes.push(dropped("v:shape", `${name}: ${NO_OPTION}`));
  }
  for (const child of elementsOf(shape)) {
    if (child.name !== "v:textbox") notes.push(dropped(child.name, NO_OPTION));
  }
  const textbox = childNamed(shape, "v:textbox");
  for (const [name, value] of Object.entries(textbox?.attributes ?? {})) {
    if (DOCX_TEXTBOX_ATTRIBUTES[name] !== value) notes.push(dropped("v:textbox", `${name}="${value}": docx.js writes its own`));
  }
  const style: ShapeStyleRead = {};
  for (const [name, value] of styleDeclarations(attrOf(shape, "style") ?? "")) {
    const entry = own(SHAPE_STYLE, name);
    const read = entry === undefined ? null : declaration(entry, value);
    if (read === null) {
      notes.push(dropped("v:shape", `style ${name}:${value}: docx.js's text box style has no value for it`));
      continue;
    }
    Object.assign(style, read);
  }
  return Object.keys(style).length === 0 ? undefined : style;
}

function declaration<K extends keyof ShapeStyle>([key, parse]: readonly [K, StyleReader<K>], value: string): ShapeStyleRead | null {
  const parsed = parse(value);
  if (parsed === null) return null;
  const style: ShapeStyleRead = {};
  style[key] = parsed;
  return style;
}

export function alternateContent(el: XmlElement, maps: (element: XmlElement) => boolean): Alternate | null {
  for (const choice of childrenNamed(el, "mc:Choice")) {
    const elements = elementsOf(choice);
    if (elements.length > 0 && elements.every(maps)) return { used: "Choice", elements };
  }
  const fallback = elementsOf(childNamed(el, "mc:Fallback"));
  return fallback.length === 0 ? null : { used: "Fallback", elements: fallback };
}
