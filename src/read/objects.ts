/** VML text boxes and mc:AlternateContent: the parts of unit 06 that are not pictures.
 *
 *  - A text box is a w:pict whose v:shape holds v:textbox/w:txbxContent. Its v:shape style becomes
 *    docx.js's VmlShapeStyle; declarations VmlShapeStyle has no key or value for are dropped. docx.js
 *    writes its own shape id, shape type #_x0000_t202 and v:textbox attributes, so those are accepted as
 *    they are, and anything else on the shape is dropped.
 *  - mc:AlternateContent is read as the first mc:Choice whose every element maps to a tree kind other than
 *    RawXml, else as its mc:Fallback. Whether an element maps is the caller's question, since it depends
 *    on the slot. */

import type * as docx from "docx";
import { dropped, type Note } from "../ooxml/codec";
import { own } from "../schema/own";
import { attrOf, childNamed, childrenNamed, elementsOf, type XmlElement } from "../ooxml/xml";

type ShapeStyle = NonNullable<ConstructorParameters<typeof docx.Textbox>[0]["style"]>;
type StyleValue = string | number | boolean;
type StyleReader = (value: string) => StyleValue | null;

export type TextBox = {
  readonly shape: XmlElement;
  readonly content: XmlElement;
};

export type Alternate = { readonly used: "Choice" | "Fallback"; readonly elements: readonly XmlElement[] };

const NO_OPTION = "docx.js has no option for it";
const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;
const MEASURE = /^-?[0-9]+(\.[0-9]+)?(mm|cm|in|pt|pc|pi|em|ex|%)$/;
const INTEGER = /^-?[0-9]+$/;

/** What docx.js writes on a text box's v:shape and v:textbox itself. */
const DOCX_SHAPE_TYPE = "#_x0000_t202";
const DOCX_TEXTBOX_ATTRIBUTES: Readonly<Record<string, string>> = {
  style: "mso-fit-shape-to-text:t;",
  insetmode: "auto",
};

const length: StyleReader = (value) => (value === "auto" || MEASURE.test(value) ? value : NUMBER.test(value) ? Number(value) : null);
const number: StyleReader = (value) => (NUMBER.test(value) ? Number(value) : null);
const oneOf =
  (values: readonly string[]): StyleReader =>
  (value) =>
    values.includes(value) ? value : null;
const flag: StyleReader = (value) => (value === "t" || value === "true" ? true : value === "f" || value === "false" ? false : null);
const zIndex: StyleReader = (value) => (value === "auto" ? value : INTEGER.test(value) ? Number(value) : null);

const POSITIONS = oneOf(["absolute", "left", "center", "right", "inside", "outside"]);
const RELATIVE_TO = oneOf(["margin", "page", "text", "char"]);

/** A v:shape style declaration → its VmlShapeStyle key and value reader, keyed as docx.js writes them. */
const SHAPE_STYLE: Readonly<Record<string, readonly [keyof ShapeStyle, StyleReader]>> = {
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
  position: ["position", oneOf(["static", "absolute", "relative"])],
  rotation: ["rotation", number],
  top: ["top", length],
  visibility: ["visibility", oneOf(["hidden", "inherit"])],
  width: ["width", length],
  "z-index": ["zIndex", zIndex],
};

/** A CSS-like style attribute's declarations in order, as [name, value]. */
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

/** The v:shape and w:txbxContent of a w:pict that is a VML text box, or null. */
export function textBoxOf(pict: XmlElement): TextBox | null {
  const shape = childNamed(pict, "v:shape");
  const content = childNamed(childNamed(shape, "v:textbox"), "w:txbxContent");
  return shape === null || content === null ? null : { shape, content };
}

/** The Textbox `style` option from a text box's v:shape, in the file's declaration order, or undefined
 *  when it has none. Everything on the shape docx.js does not write is noted dropped. */
export function textBoxStyle(box: TextBox, notes: Note[]): Readonly<Record<string, StyleValue>> | undefined {
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
  const style: Record<string, StyleValue> = {};
  for (const [name, value] of styleDeclarations(attrOf(shape, "style") ?? "")) {
    const entry = own(SHAPE_STYLE, name);
    const read = entry === undefined ? null : entry[1](value);
    if (entry === undefined || read === null) {
      notes.push(dropped("v:shape", `style ${name}:${value}: docx.js's text box style has no value for it`));
      continue;
    }
    style[entry[0]] = read;
  }
  return Object.keys(style).length === 0 ? undefined : style;
}

/** mc:AlternateContent's content: the first mc:Choice whose every element `maps`, else the mc:Fallback's,
 *  or null when the Fallback is absent or empty. */
export function alternateContent(el: XmlElement, maps: (element: XmlElement) => boolean): Alternate | null {
  for (const choice of childrenNamed(el, "mc:Choice")) {
    const elements = elementsOf(choice);
    if (elements.length > 0 && elements.every(maps)) return { used: "Choice", elements };
  }
  const fallback = elementsOf(childNamed(el, "mc:Fallback"));
  return fallback.length === 0 ? null : { used: "Fallback", elements: fallback };
}
