/** Unzips a rendered .docx into the XML parts the snapshots compare, with random ids made stable and
 *  one element per line.
 *
 *  - docx.js gives an external hyperlink `rId` plus a lowercased 21-character nanoid, and each text box's
 *    VML shape id a fresh uniqueId(), so both change on every render. Its own sequential ids (rId1…) are
 *    short and stay as they are.
 *  - docProps/core.xml carries render timestamps, so docProps/* is dropped. */

import { strFromU8, unzipSync } from "fflate";

export type DocxXml = Readonly<Record<string, string>>;

const RANDOM_REL_ID = /rId[a-z0-9_-]{20,}/g;
const VML_SHAPE_ID = /(?<=<v:shape id=")[^"]+/g;

function isComparedPart(name: string): boolean {
  return (
    name === "[Content_Types].xml" ||
    /^word\/.+\.xml$/.test(name) ||
    /^word\/_rels\/[^/]+\.rels$/.test(name)
  );
}

function scanOrder(names: string[]): string[] {
  const rest = names.filter((n) => n !== "word/document.xml").sort();
  return names.includes("word/document.xml") ? ["word/document.xml", ...rest] : rest;
}

function stableIds(parts: Record<string, string>, pattern: RegExp, prefix: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const name of scanOrder(Object.keys(parts))) {
    for (const [id] of parts[name].matchAll(pattern)) {
      if (!ids.has(id)) ids.set(id, `${prefix}${ids.size + 1}`);
    }
  }
  return ids;
}

export function docxXml(bytes: Uint8Array | ArrayBuffer): DocxXml {
  const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const parts: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    if (isComparedPart(name)) parts[name] = strFromU8(content);
  }

  const relIds = stableIds(parts, RANDOM_REL_ID, "rIdLink");
  const shapeIds = stableIds(parts, VML_SHAPE_ID, "vShape");
  const result: Record<string, string> = {};
  for (const [name, xml] of Object.entries(parts)) {
    result[name] = xml
      .replace(RANDOM_REL_ID, (id) => relIds.get(id) ?? id)
      .replace(VML_SHAPE_ID, (id) => shapeIds.get(id) ?? id)
      .replaceAll("><", ">\n<");
  }
  return result;
}
