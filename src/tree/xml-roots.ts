/** A fragment's top-level element names, or why the fragment is not well-formed. */
export type XmlRoots =
  | { readonly kind: "roots"; readonly roots: readonly string[] }
  | { readonly kind: "malformed"; readonly reason: string };

/** Markup that is skipped whole: where it starts, where it ends, and whether it may stand at the top level. */
const SKIPPED = [
  { open: "<!--", close: "-->", topLevel: true },
  { open: "<?", close: "?>", topLevel: true },
  { open: "<![CDATA[", close: "]]>", topLevel: false },
] as const;

const NAME = /^[^\s/>]+/;

function malformed(reason: string): XmlRoots {
  return { kind: "malformed", reason };
}

/** The index of the `>` closing the tag that starts at `from`, skipping quoted attribute values; -1 if none. */
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

/** Parser-free, because canonicalize also runs in the browser: tracks open elements over start, end and
 *  self-closing tags and records the names of those that open at the top level. Comments and processing
 *  instructions are skipped; text and CDATA are allowed only inside an element. */
export function xmlRoots(xml: string): XmlRoots {
  const roots: string[] = [];
  const open: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt).trim();
    if (open.length === 0 && text !== "") return malformed(`text "${text}" stands outside an element`);
    if (lt === -1) break;

    const skipped = SKIPPED.find((markup) => xml.startsWith(markup.open, lt));
    if (skipped !== undefined) {
      const end = xml.indexOf(skipped.close, lt + skipped.open.length);
      if (end === -1) return malformed(`${skipped.open} is never closed`);
      if (open.length === 0 && !skipped.topLevel) return malformed(`${skipped.open} stands outside an element`);
      i = end + skipped.close.length;
      continue;
    }
    if (xml.startsWith("<!", lt)) return malformed("declarations (<!…>) are not allowed");

    const end = tagEnd(xml, lt + 1);
    if (end === -1) return malformed(`the tag at offset ${lt} is never closed with ">"`);
    i = end + 1;

    if (xml[lt + 1] === "/") {
      const name = xml.slice(lt + 2, end).trim();
      const expected = open.pop();
      if (expected === undefined) return malformed(`</${name}> closes nothing`);
      if (name !== expected) return malformed(`</${name}> closes <${expected}>`);
      continue;
    }
    const name = NAME.exec(xml.slice(lt + 1, end))?.[0];
    if (name === undefined) return malformed(`the tag at offset ${lt} has no name`);
    if (open.length === 0) roots.push(name);
    if (xml[end - 1] !== "/") open.push(name);
  }
  if (open.length > 0) return malformed(`<${open[open.length - 1]}> is never closed`);
  return { kind: "roots", roots };
}
