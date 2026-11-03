import { xml2js, type Element as XmlJsElement, type ElementCompact } from "xml-js";
import { ImportedXmlComponent, convertToXmlComponent, type XmlComponent } from "docx";

/** Fragment → one docx.js component per top-level element. The fragment must have passed canonicalize.
 *
 *  Not `ImportedXmlComponent.fromXmlString`: in docx 9.5.1 it writes an `<undefined>` wrapper element.
 *  The `<x>` wrapper lets a fragment of several elements parse. `captureSpacesBetweenElements` keeps a
 *  whitespace-only text such as `<w:t xml:space="preserve"> </w:t>`, which xml-js drops by default;
 *  `withoutIndentation` then removes the whitespace it also captures between elements. */
export function rawXmlComponents(xml: string): XmlComponent[] {
  const parsed = xml2js(`<x>${xml}</x>`, { compact: false, captureSpacesBetweenElements: true });
  if (!isNonCompact(parsed)) throw new Error("xml2js returned its compact shape despite compact: false");
  const roots = parsed.elements?.[0]?.elements ?? [];
  const elements = roots.filter((element) => element.type === "element");
  return elements.map(elementsAndText).map(withoutIndentation).map(component);
}

/** Only elements and text, as docx.js writes them. A CDATA section, which docx.js drops, becomes text; a
 *  comment or processing instruction, which splits text into pieces docx.js writes only the last of, is
 *  dropped. Adjacent text is then joined, and docx.js escapes it. */
function elementsAndText(element: XmlJsElement): XmlJsElement {
  const children = element.elements;
  if (children === undefined) return element;
  const kept: XmlJsElement[] = [];
  for (const child of children) {
    const node = child.type === "cdata" ? { type: "text", text: child.cdata } : child;
    if (node.type === "element") {
      kept.push(elementsAndText(node));
      continue;
    }
    if (node.type !== "text") continue;
    const last = kept[kept.length - 1];
    if (last?.type === "text") {
      kept[kept.length - 1] = { type: "text", text: `${String(last.text)}${String(node.text)}` };
    } else {
      kept.push(node);
    }
  }
  return { ...element, elements: kept };
}

/** xml2js declares one return type for both its modes; the non-compact shape holds the document's `elements`. */
function isNonCompact(parsed: XmlJsElement | ElementCompact): parsed is XmlJsElement {
  return Array.isArray(parsed.elements);
}

/** Drops whitespace text that sits beside a sibling element, at every depth. Such text is indentation,
 *  and docx.js loses the element before it when it writes a mix of text and elements. Whitespace that is
 *  an element's only content, as in `<w:t xml:space="preserve"> </w:t>`, is kept. */
function withoutIndentation(element: XmlJsElement): XmlJsElement {
  const children = element.elements;
  if (children === undefined) return element;
  const hasElementChild = children.some((child) => child.type === "element");
  const kept = hasElementChild ? children.filter((child) => !isWhitespaceText(child)) : children;
  return { ...element, elements: kept.map(withoutIndentation) };
}

const XML_WHITESPACE = /^[ \t\r\n]*$/;

function isWhitespaceText(node: XmlJsElement): boolean {
  return node.type === "text" && typeof node.text === "string" && XML_WHITESPACE.test(node.text);
}

function component(element: XmlJsElement): XmlComponent {
  const converted = convertToXmlComponent(element);
  if (converted instanceof ImportedXmlComponent) return converted;
  throw new Error(`convertToXmlComponent returned ${typeof converted} for the element <${element.name}>`);
}
