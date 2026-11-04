/** Reads a RawXml fragment's top-level element names, or says why it is not well-formed or why docx.js
 *  cannot write it. It uses no XML parser, because canonicalize also runs in browsers.
 *
 *  - An attribute named r:… is a relationship reference (r:id, r:embed, …). docx.js cannot write its
 *    target, so it is its own kind and callers word it themselves. r: in text is not one.
 *
 *  - XML whitespace is only space, tab, CR and LF. String.prototype.trim also strips U+00A0, U+FEFF and
 *    others, so it is not used.
 *  - docx.js writes an element's text after its last child element and drops the element before it, so
 *    an element that mixes text and child elements is rejected.
 *  - docx.js's writer-side parser also decodes HTML entities but the reader's parser does not, so only
 *    XML's five entities and character references are accepted. */

type XmlRoots =
  | { readonly kind: "roots"; readonly roots: readonly string[] }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "unwritable"; readonly reason: string }
  | { readonly kind: "relationship"; readonly reason: string };

const SKIPPED = [
  { open: "<!--", close: "-->", topLevel: true },
  { open: "<?", close: "?>", topLevel: true },
  { open: "<![CDATA[", close: "]]>", topLevel: false },
] as const;

const NAME = /^[^\s/>]+/;
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const AMPERSAND = /&(?:#([0-9]+);|#x([0-9a-fA-F]+);|([A-Za-z_:][\w.:-]*);)?/g;
const CHARACTER_REFERENCE = /&#([0-9]+);|&#x([0-9a-fA-F]+);/g;
const PREDEFINED_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
const XML_SPACE_AROUND = /^[ \t\r\n]+|[ \t\r\n]+$/g;

type Open = { readonly name: string; text: string | null; hasElement: boolean };

function malformed(reason: string): XmlRoots {
  return { kind: "malformed", reason };
}

function mixedContent(element: Open): XmlRoots | null {
  if (element.text === null || !element.hasElement) return null;
  const reason = `<${element.name}> mixes text "${element.text}" with elements, and docx.js drops the element before the text`;
  return { kind: "unwritable", reason };
}

function xmlTrim(text: string): string {
  return text.replace(XML_SPACE_AROUND, "");
}

function isXmlCharacter(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

function referenceProblem(text: string): XmlRoots | null {
  for (const [reference, decimal, hex, entity] of text.matchAll(AMPERSAND)) {
    if (reference === "&") return malformed(`a bare "&" in "${xmlTrim(text)}": write &amp;`);
    if (entity !== undefined && !PREDEFINED_ENTITIES.has(entity)) {
      return malformed(`${reference} is not an XML entity: write a character reference such as &#160;`);
    }
    const code = decimal !== undefined ? parseInt(decimal, 10) : hex !== undefined ? parseInt(hex, 16) : null;
    if (code !== null && !isXmlCharacter(code)) return malformed(`${reference} is not a character XML allows`);
  }
  return null;
}

function decodeCharacterReferences(text: string): string {
  return text.replace(CHARACTER_REFERENCE, (_, decimal: string | undefined, hex: string | undefined) =>
    String.fromCodePoint(decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex ?? "", 16))
  );
}

function attributesProblem(name: string, attributes: string): XmlRoots | null {
  const seen = new Set<string>();
  let at = 0;
  while (attributes.slice(at).trim() !== "") {
    ATTRIBUTE.lastIndex = at;
    const match = ATTRIBUTE.exec(attributes);
    if (match === null) {
      return malformed(`the attributes of <${name}> are not name="value" pairs: ${attributes.slice(at).trim()}`);
    }
    const [, attribute, doubleQuoted, singleQuoted] = match;
    if (seen.has(attribute)) return malformed(`<${name}> has the attribute ${attribute} twice`);
    seen.add(attribute);
    if (attribute.startsWith("r:")) {
      return { kind: "relationship", reason: `<${name}> has the relationship reference ${attribute}` };
    }
    const problem = referenceProblem(doubleQuoted ?? singleQuoted);
    if (problem !== null) return problem;
    at = ATTRIBUTE.lastIndex;
  }
  return null;
}

function tagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i++) {
    const char = xml[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i;
    }
  }
  return -1;
}

export function xmlRoots(xml: string): XmlRoots {
  const roots: string[] = [];
  const open: Open[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const rawText = xml.slice(i, lt === -1 ? xml.length : lt);
    const text = xmlTrim(rawText);
    const parent = open[open.length - 1];
    if (parent === undefined && text !== "") return malformed(`text "${text}" stands outside an element`);
    if (parent !== undefined && text !== "") {
      const problem = referenceProblem(text);
      if (problem !== null) return problem;
      if (xmlTrim(decodeCharacterReferences(text)) !== "") parent.text ??= text;
    }
    if (lt === -1) break;

    const skipped = SKIPPED.find((markup) => xml.startsWith(markup.open, lt));
    if (skipped !== undefined) {
      const end = xml.indexOf(skipped.close, lt + skipped.open.length);
      if (end === -1) return malformed(`${skipped.open} is never closed`);
      if (parent === undefined && !skipped.topLevel) return malformed(`${skipped.open} stands outside an element`);
      const data = xml.slice(lt + skipped.open.length, end);
      if (skipped.open === "<!--" && (data.includes("--") || data.endsWith("-"))) return malformed("a comment holds --");
      if (skipped.open === "<![CDATA[" && parent !== undefined && xmlTrim(data) !== "") parent.text ??= xmlTrim(data);
      i = end + skipped.close.length;
      continue;
    }
    if (xml.startsWith("<!", lt)) return malformed("declarations (<!…>) are not allowed");

    const end = tagEnd(xml, lt + 1);
    if (end === -1) return malformed(`the tag at offset ${lt} is never closed with ">"`);
    i = end + 1;

    if (xml[lt + 1] === "/") {
      const name = xml.slice(lt + 2, end).trim();
      const closed = open.pop();
      if (closed === undefined) return malformed(`</${name}> closes nothing`);
      if (name !== closed.name) return malformed(`</${name}> closes <${closed.name}>`);
      const mixed = mixedContent(closed);
      if (mixed !== null) return mixed;
      continue;
    }
    const selfClosing = xml[end - 1] === "/";
    const tag = xml.slice(lt + 1, selfClosing ? end - 1 : end);
    const name = NAME.exec(tag)?.[0];
    if (name === undefined) return malformed(`the tag at offset ${lt} has no name`);
    const attributes = attributesProblem(name, tag.slice(name.length));
    if (attributes !== null) return attributes;
    if (parent === undefined) roots.push(name);
    else parent.hasElement = true;
    if (!selfClosing) open.push({ name, text: null, hasElement: false });
  }
  const unclosed = open[open.length - 1];
  if (unclosed !== undefined) return malformed(`<${unclosed.name}> is never closed`);
  return { kind: "roots", roots };
}
