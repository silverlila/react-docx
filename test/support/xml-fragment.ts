import { elementsOf, parseXml, type XmlElement } from "../../src/ooxml/xml";

export function parseXmlFragment(text: string): readonly XmlElement[] {
  return elementsOf(parseXml(`<x>${text}</x>`));
}
