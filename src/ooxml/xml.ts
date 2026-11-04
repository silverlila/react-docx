/** Plain XML values for the read side, and the one place that touches the XML parser: codecs and the HTML
 *  resolver never see htmlparser2's types.
 *
 *  - htmlparser2 decodes entities but hands back CDATA sections, comments, processing instructions and the
 *    XML declaration as nodes of their own. parseXml reads CDATA as text and drops the rest. */

import type { ChildNode } from "domhandler";
import { parseDocument } from "htmlparser2";
import { own } from "../schema/own";

export type XmlElement = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly (XmlElement | string)[];
};

const OFF = new Set(["0", "false", "off"]);

function contentOf(nodes: readonly ChildNode[]): (XmlElement | string)[] {
  const content: (XmlElement | string)[] = [];
  const pushText = (text: string) => {
    const last = content.length - 1;
    if (last >= 0 && typeof content[last] === "string") content[last] += text;
    else content.push(text);
  };
  for (const node of nodes) {
    if (node.type === "tag") content.push(elementOf(node.name, node.attribs, node.children));
    else if (node.type === "text") pushText(node.data);
    else if (node.type === "cdata") {
      for (const inner of contentOf(node.children)) {
        if (typeof inner === "string") pushText(inner);
        else content.push(inner);
      }
    }
  }
  return content;
}

function elementOf(name: string, attributes: Record<string, string>, children: readonly ChildNode[]): XmlElement {
  return { name, attributes: { ...attributes }, children: contentOf(children) };
}

/** Every top-level element of `text`, which may hold several. */
export function parseXmlRoots(text: string): XmlElement[] {
  return contentOf(parseDocument(text, { xmlMode: true }).children).filter(
    (node): node is XmlElement => typeof node !== "string"
  );
}

export function parseXml(text: string): XmlElement {
  const [root] = parseXmlRoots(text);
  if (root === undefined) throw new Error(`parseXml: no element in ${JSON.stringify(text.slice(0, 80))}`);
  return root;
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

export function serializeXml(el: XmlElement): string {
  const attributes = Object.keys(el.attributes)
    .map((name) => ` ${name}="${escapeAttribute(el.attributes[name])}"`)
    .join("");
  if (el.children.length === 0) return `<${el.name}${attributes}/>`;
  const inner = el.children.map((child) => (typeof child === "string" ? escapeText(child) : serializeXml(child)));
  return `<${el.name}${attributes}>${inner.join("")}</${el.name}>`;
}

export const elementsOf = (el: XmlElement | null): XmlElement[] =>
  el === null ? [] : el.children.filter((child): child is XmlElement => typeof child !== "string");

export const childNamed = (el: XmlElement | null, name: string): XmlElement | null =>
  elementsOf(el).find((child) => child.name === name) ?? null;

export const childrenNamed = (el: XmlElement | null, name: string): XmlElement[] =>
  elementsOf(el).filter((child) => child.name === name);

export const attrOf = (el: XmlElement | null, name: string): string | null =>
  el === null ? null : (own(el.attributes, name) ?? null);

export const isOn = (el: XmlElement | null): boolean => el !== null && !OFF.has(attrOf(el, "w:val") ?? "true");

export const textOf = (el: XmlElement): string =>
  el.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
