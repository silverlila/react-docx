/** Parses XML that has several top-level elements by wrapping it in a throwaway root. */

import { elementsOf, parseXml, type XmlElement } from "../../src/ooxml/xml";

export function parseXmlFragment(text: string): readonly XmlElement[] {
  return elementsOf(parseXml(`<x>${text}</x>`));
}
