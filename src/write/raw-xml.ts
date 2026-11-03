/** Turns a RawXml fragment that passed canonicalize into docx.js components, one per top-level element.
 *
 *  - docx 9.5.1's `ImportedXmlComponent.fromXmlString` writes an `<undefined>` wrapper element, so the
 *    fragment is wrapped in `<x>` and parsed with xml-js instead.
 *  - xml-js drops a whitespace-only text such as `<w:t xml:space="preserve"> </w:t>` unless
 *    captureSpacesBetweenElements is set. That option also keeps the indentation between elements,
 *    which must go: docx.js loses the element before a whitespace text when it writes a mix of text and
 *    elements.
 *  - docx.js drops CDATA sections, so they become text. A comment or processing instruction splits text
 *    into pieces of which docx.js writes only the last, so those are dropped. */

import { xml2js, type Element as XmlJsElement, type ElementCompact } from "xml-js";
import { ImportedXmlComponent, convertToXmlComponent, type XmlComponent } from "docx";

export function rawXmlComponents(xml: string): XmlComponent[] {
  const parsed = xml2js(`<x>${xml}</x>`, { compact: false, captureSpacesBetweenElements: true });
  if (!isNonCompact(parsed)) throw new Error("xml2js returned its compact shape despite compact: false");
  const roots = parsed.elements?.[0]?.elements ?? [];
  const elements = roots.filter((element) => element.type === "element");
  return elements.map(elementsAndText).map(withoutIndentation).map(component);
}

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

function isNonCompact(parsed: XmlJsElement | ElementCompact): parsed is XmlJsElement {
  return Array.isArray(parsed.elements);
}

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
