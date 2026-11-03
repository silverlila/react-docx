# 05 — `RawXml`, the escape hatch

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC12
- **You will see**: `<RawXml xml={'<w:sdt>…</w:sdt>'} />` in a Section, `<RawXml xml={'<w:r>…</w:r>'} />` in a Paragraph, and `<RawXml xml={'<w:fldChar …/>'} />` inside a TextRun each land verbatim in `word/document.xml`. A raw `<w:style>` passed in `styles.importedStyles` lands in `word/styles.xml` next to docx.js's defaults.

## Goal

Add the `RawXml` kind, legal in block, inline and run positions, and its writer. Also accept raw `<w:style>` XML strings in `Document.styles.importedStyles`.

Both carry OOXML that docx.js cannot express. Phase 2's reader emits them for content it cannot map. Two kinds of unsafe raw XML are rejected: raw XML containing relationship references (`r:*` attributes), and raw XML whose root elements don't belong in the position where it stands.

## Files

- `src/schema/elements.ts`: add a `RawXml` row. Add `"RawXml"` to `BLOCK`, `INLINE` and `RUN_CONTENT`. `StylesProps` gains `importedStyles`.
- `src/schema/docx-facts.ts`: add `RAW_XML_ROOTS`.
- `src/tree/xml-roots.ts`: new. A parser-free scanner for a fragment's top-level element names.
- `src/tree/canonical.ts`: rules 13–16 (Change 3).
- `src/write/raw-xml.ts`: new. Fragment string → docx.js components.
- `src/write/build.ts`: the `RawXml` builder; appending raw styles.
- `src/components.ts`, `src/types.ts`, `src/index.ts`: the `RawXml` component and `RawXmlProps`.
- `package.json`: add `"xml-js": "^1.6.8"` to `dependencies`.
- `test/raw-xml.test.tsx`: new (AC12).
- `test/canonical.test.ts`: add tests for rules 13–16.

## Changes

### 1. The kind

| Kind | docx | children | text | ooxml | props |
|---|---|---|---|---|---|
| RawXml | `"ImportedXmlComponent"` | `[]` | no | `[]` | `{ readonly xml: string }` |

`xml` is a **fragment**: one or more sibling OOXML elements, such as `<w:fldChar …/><w:instrText>…</w:instrText><w:fldChar …/>`. Prefixes may be any that docx.js declares on its part roots (`w`, `r`, `wp`, `a`, `pic`, `m`, `mc`, `v`, `o`, `w10`, `w14`, `w15`, `wps`, `wpg`, and others). An undeclared prefix is not checked; Word would report it.

```ts
// src/schema/elements.ts
export type StylesProps = Omit<docx.IStylesOptions, "importedStyles" | "initialStyles"> & {
  /** Raw <w:style> elements, as XML strings, written after docx.js's own styles. */
  readonly importedStyles?: readonly string[];
};
```

### 2. `src/schema/docx-facts.ts`: allowed fragment roots

```ts
export const RAW_XML_ROOTS = {
  block:  ["w:p", "w:tbl", "w:sdt", "w:customXml", "w:bookmarkStart", "w:bookmarkEnd"],
  inline: ["w:r", "w:hyperlink", "w:sdt", "w:fldSimple", "w:ins", "w:del", "w:moveFrom", "w:moveTo",
           "w:bookmarkStart", "w:bookmarkEnd", "w:commentRangeStart", "w:commentRangeEnd",
           "w:smartTag", "w:customXml", "w:proofErr", "m:oMath", "m:oMathPara"],
  run:    ["w:t", "w:delText", "w:tab", "w:br", "w:cr", "w:fldChar", "w:instrText", "w:sym",
           "w:softHyphen", "w:noBreakHyphen", "w:ptab", "w:lastRenderedPageBreak", "w:separator", "w:continuationSeparator"],
  style:  ["w:style"],
} as const;
```

`w:footnoteReference`, `w:endnoteReference` and `w:commentReference` are deliberately absent from `run`. Their ids would point at notes the tree does not contain.

Which list applies:
- Section, Header, Footer and TableCell use `block`.
- Paragraph, ExternalHyperlink, InternalHyperlink and Bookmark use `inline`.
- TextRun uses `run`.

### 3. Canonical rules 13–16 (`src/tree/canonical.ts`)

- **13. Fragment roots.** `xmlRoots(xml)` from `src/tree/xml-roots.ts` returns the qualified names of the fragment's top-level elements. It must return at least one name, and every name must be in the parent's slot list. Otherwise throw `TreeError(path, "RawXml <w:x> is not allowed in <Parent>")`. An empty or text-only fragment throws `"RawXml must contain at least one element"`.
- **14. No relationship references.** If `/\sr:[A-Za-z]+\s*=/.test(xml)`, throw `TreeError(path, "RawXml cannot carry relationship references (r:id, r:embed, …): docx.js cannot write their targets")`. This covers authored and, later, read input alike (decision 10).
- **15. TableCell must end with a Paragraph.** If a TableCell's last canonical child is `RawXml`, throw `TreeError(path, "A TableCell must end with a <Paragraph>")`. Verified 2026-11-03: docx.js appends an empty `<w:p/>` after any trailing non-`Paragraph` child, even a raw `<w:p>`.
- **16. `styles.importedStyles`.**
  - Every entry must be a string, or throw `"styles.importedStyles takes XML strings"`. Authoring with docx.js components is not supported. This breaking change is listed in decision 12.
  - Each string's roots must all be `w:style`.
  - It must contain no `r:` attribute.
  - Its `w:styleId` values (found with `/w:styleId="([^"]+)"/g`) must not equal a `DEFAULT_STYLE_SLOTS` id or any `paragraphStyles`/`characterStyles` id. A collision would produce two definitions of one id.

`src/tree/xml-roots.ts` is a small scanner, with no parser dependency, because canonicalize runs in the browser in phase 2:
- skip whitespace, comments (`<!-- … -->`) and processing instructions (`<? … ?>`);
- track depth over start tags, end tags and self-closing tags, honoring quoted attribute values that may contain `>`;
- record the names of start or self-closing tags at depth 0;
- throw `TreeError` on an unbalanced fragment.

Test it directly.

### 4. `src/write/raw-xml.ts`

```ts
import { xml2js, type Element as XmlJsElement } from "xml-js";
import { convertToXmlComponent, type XmlComponent } from "docx";

/** Fragment → one docx component per top-level element. */
export function rawXmlComponents(xml: string): XmlComponent[] {
  // const root = xml2js(`<x>${xml}</x>`, { compact: false }) as XmlJsElement;
  // return root.elements![0].elements!.filter((e) => e.type === "element").map((e) => convertToXmlComponent(e) as XmlComponent);
}
```

Do **not** use `ImportedXmlComponent.fromXmlString`: in docx 9.5.1 it emits an `<undefined>` wrapper element. The `<x>` wrapper lets a multi-element fragment parse.

`xml-js` is a dependency of docx, but pnpm does not hoist it, so add it to our own `dependencies`. It is pure JavaScript.

### 5. Writer (`src/write/build.ts`)

- **The RawXml builder.** `RawXml: (n) => rawXmlComponents(n.props.xml)` returns an array, so Section, Header, Footer, TableCell, Paragraph, hyperlink, bookmark and TextRun children must flatten arrays. Paragraph and Section already flatten TextRun arrays. Extend that to TextRun children and TableCell. docx.js pushes non-string run children as-is (verified 2026-11-03: raw `w:fldChar`/`w:instrText` inside `new TextRun({ children: [...] })` wrote verbatim).
- **The cast.** docx.js's TypeScript child unions are closed, and `FileChild` is a branded type. Cast in exactly one helper, `asChildren<T>(components: XmlComponent[]): T[]`, with a comment saying why.
- **Raw styles.** After `new docx.Document(...)` is built, for each `styles.importedStyles` string, call `doc.Styles.addChildElement(component)` for every component from `rawXmlComponents`. `Styles` is a public getter on docx's `File`, and `addChildElement` is public on `XmlComponent`.

  Verified 2026-11-03: the raw `<w:style w:styleId="TableGrid">` appeared in `word/styles.xml`, and `Heading1` and `w:docDefaults` were still there.

  Do not pass `importedStyles` to docx.js's `styles` option. docx spreads the user's `styles` over its defaults, so `importedStyles` would replace the whole default list.

### 6. Component

`export const RawXml = element<RawXmlProps>("RawXml")` with `RawXmlProps = { xml: string; children?: never }`. Add `RawXml` and `RawXmlProps` to `src/index.ts`'s exports. Override `DocumentProps.styles` in `src/types.ts` so that `importedStyles` is `readonly string[]`.

### 7. `test/raw-xml.test.tsx` (AC12)

Each test asserts on `docxXml(...)`:

1. **Block position.** `<Section><RawXml xml="<w:sdt><w:sdtContent><w:p><w:r><w:t>in sdt</w:t></w:r></w:p></w:sdtContent></w:sdt>" /></Section>` puts that exact string in the body.
2. **Inline position.** `<Paragraph><RawXml xml='<w:r><w:t xml:space="preserve"> sp a </w:t></w:r>' /></Paragraph>` keeps the spaces.
3. **Run content.** `<TextRun>x<RawXml xml='<w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> DATE </w:instrText><w:fldChar w:fldCharType="end"/>' /></TextRun>` puts all three elements inside the same `<w:r>`, after `x`.
4. **Raw styles.** `styles={{ importedStyles: ['<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>'] }}` puts TableGrid in `word/styles.xml`, and `Heading1` is still present.
5. **Rejections.** Each of these throws `TreeError`:
   - `<RawXml xml='<w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r>' />` (relationship reference);
   - `<RawXml xml="<w:p/>" />` inside a Paragraph (wrong root for the slot);
   - a TableCell whose last child is RawXml;
   - an `importedStyles` entry with `w:styleId="Heading1"` (collision).
6. **Renders verbatim.** `renderToTree` output containing RawXml is written identically to the JSX input. Extend `test/tree-input.test.tsx`'s `CASES` loop by adding one RawXml case to `test/support/cases.tsx`, then re-record its snapshot. It is a new case, so this is not a behavior change.

## Verify

```sh
pnpm install
pnpm test
pnpm run type-check
pnpm run build
```

## Watch out

- The `r:` check is a regex on purpose. The writer must not need the parser to reject, and false positives would require an attribute literally named `r:something`, which only exists for relationships.
- `xml-js`'s `xml2js` keeps attribute order and text exactly. Do not pass `compact: true`, because `convertToXmlComponent` expects the non-compact shape.
- Adding `RawXml` to `RUN_CONTENT` widens `Node<"TextRun">`'s child union. Check that `type-check` time is still under the unit-03 budget.
