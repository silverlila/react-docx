import { strFromU8, unzipSync } from "fflate";

/** The parts the snapshots compare, each pretty-printed one element per line. */
export type DocxXml = Readonly<Record<string, string>>;

/** External hyperlink relationship ids are `rId` + docx.js's `uniqueId()`, a lowercased 21-char nanoid,
 *  so random per render. docx.js's own sequential ids (`rId1`…) are short and untouched. */
const RANDOM_REL_ID = /rId[a-z0-9_-]{20,}/g;
/** Each text box's VML shape id is a fresh docx.js `uniqueId()`. Matches the id value alone. */
const VML_SHAPE_ID = /(?<=<v:shape id=")[^"]+/g;

function isComparedPart(name: string): boolean {
  return (
    name === "[Content_Types].xml" ||
    /^word\/.+\.xml$/.test(name) ||
    /^word\/_rels\/[^/]+\.rels$/.test(name)
  );
}

/** document.xml first, so its ids are numbered in order of appearance there; then the rest by name. */
function scanOrder(names: string[]): string[] {
  const rest = names.filter((n) => n !== "word/document.xml").sort();
  return names.includes("word/document.xml") ? ["word/document.xml", ...rest] : rest;
}

/** Each distinct match of `pattern` → `<prefix>1`, `<prefix>2`, … in order of first appearance. */
function stableIds(parts: Record<string, string>, pattern: RegExp, prefix: string): Map<string, string> {
  const ids = new Map<string, string>();
  for (const name of scanOrder(Object.keys(parts))) {
    for (const [id] of parts[name].matchAll(pattern)) {
      if (!ids.has(id)) ids.set(id, `${prefix}${ids.size + 1}`);
    }
  }
  return ids;
}

/** Unzips with fflate's unzipSync. Keeps every `word/**.xml` part, every `word/_rels/*.rels` part
 *  and `[Content_Types].xml`. Drops `docProps/*`, because core.xml carries render timestamps.
 *  Normalizes, then pretty-prints by replacing every `><` with `>\n<`. */
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
