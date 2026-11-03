# 01 — XML values and the OPC package layer

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC3
- **You will see**: `openPackage(bytes)` on any `.docx` (try `examples/resume.docx`) returns its parts, relationships, media, theme fonts and colours, and title as plain objects. `test/support/docx-fixture.ts` builds a `.docx` in memory from XML strings for every later test.

## Goal

Lay the read side's foundation. That means a plain `XmlElement` type with a parser and a deterministic serializer, plus the package layer ported from folio's `packages/rebuild/docx-parts.ts`: unzip, relationships, part and media lookup, theme, core properties.

No body reading happens yet. That starts in unit 04.

## Files

- `package.json`: move `fflate` from devDependencies to `dependencies`; add `"htmlparser2": "^10.1.0"` and `"domhandler": "^5.0.3"` to `dependencies`.
- `pnpm-lock.yaml`: regenerated.
- `src/read/xml.ts`: new. `XmlElement`, `parseXml`, `serializeXml` and query helpers.
- `src/read/package.ts`: new. `openPackage`, `OpcPackage`, `Rel`, `NotADocxError`, theme and core properties.
- `test/support/docx-fixture.ts`: new. Ported from `folio/packages/rebuild/test/docx-fixture.ts`.
- `test/read-package.test.ts`: new (AC3).

## Changes

### 1. `src/read/xml.ts`

```ts
/** Plain XML element. Qualified names keep their prefix ("w:p"); attributes by qualified name ("w:val").
 *  Text children are decoded strings. Comments and processing instructions are not kept. */
export type XmlElement = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly (XmlElement | string)[];
};

/** Parses one XML document or fragment root with htmlparser2 parseDocument(text, { xmlMode: true }),
 *  converting domhandler nodes into XmlElement right away. Returns the first top-level element. */
export function parseXml(text: string): XmlElement;
/** Parses a fragment of sibling elements ("<a/><b/>") by wrapping it in "<x>…</x>". Returns the children. */
export function parseXmlFragment(text: string): readonly XmlElement[];
/** Deterministic: attributes in stored order, `&` `<` `>` `"` escaped in attribute values, `&` `<` `>` escaped in text,
 *  an element with no children written as `<name …/>`. No whitespace added. */
export function serializeXml(el: XmlElement): string;

export const elementsOf: (el: XmlElement | null) => XmlElement[];
export const childNamed: (el: XmlElement | null, name: string) => XmlElement | null;
export const childrenNamed: (el: XmlElement | null, name: string) => XmlElement[];
export const attrOf: (el: XmlElement | null, name: string) => string | null;
/** OOXML on/off: present with no w:val, or w:val not in {"0","false","off"} → true. */
export const isOn: (el: XmlElement | null) => boolean;
export const textOf: (el: XmlElement) => string;   // concatenated descendant text
```

- `domhandler` is a type-only import. Only `parseXml` and `parseXmlFragment` touch htmlparser2.
- Whitespace-only text children between elements are kept as parsed. Consumers skip them, and `serializeXml(parseXml(s))` must reproduce `s` for XML written without indentation, which is how Word and docx.js write.

### 2. `src/read/package.ts`

```ts
export class NotADocxError extends Error { name = "NotADocxError"; }
export type Rel = { readonly type: string; readonly target: string; readonly external: boolean };
export type ThemeFonts = { readonly major: ThemeFontSet; readonly minor: ThemeFontSet };
export type ThemeFontSet = { readonly latin: string | null; readonly eastAsia: string | null; readonly complex: string | null };
/** Word theme colour names → 6-digit hex. Keys: dk1 lt1 dk2 lt2 accent1–6 hlink folHlink. */
export type ThemeColors = Readonly<Record<string, string>>;
export type CoreProperties = { readonly title?: string; readonly subject?: string; readonly creator?: string;
  readonly keywords?: string; readonly description?: string; readonly lastModifiedBy?: string; readonly revision?: number };

export type OpcPackage = {
  readonly mainPart: string;                                   // "word/document.xml" normally
  part(path: string): XmlElement | null;                       // root element of a zip path, parsed once and cached
  relsOf(partPath: string): ReadonlyMap<string, Rel>;          // targets resolved to zip paths, relative to partPath's folder
  media(path: string): Uint8Array | null;
  hasPart(path: string): boolean;
  readonly paths: readonly string[];                           // every zip entry, for "part skipped" diagnostics
  readonly theme: { readonly fonts: ThemeFonts; readonly colors: ThemeColors };
  readonly core: CoreProperties;
};
export function openPackage(bytes: Uint8Array): OpcPackage;
```

Port from `folio/packages/rebuild/docx-parts.ts`: `unzip` (lines 215–221), `readRels` (205–213), `zipPath` (196–203) and `openDocx` (223–256). Change three things:

- **Find the main part properly.** Read `_rels/.rels` and take the target of the relationship whose `Type` ends with `/officeDocument`. Fall back to `word/document.xml`. Throw `NotADocxError` if the zip does not open, has no `[Content_Types].xml`, or has no main part.
- **Resolve targets against the source part's folder,** not always `word/`. For example, `word/_rels/document.xml.rels` target `media/image1.png` → `word/media/image1.png`, and target `/word/x.xml` is absolute. Keep folio's handling of `..` and `.`. External targets (`TargetMode="External"`) are stored as-is.
- **Read more of the theme.** From `word/theme/theme1.xml`, through the `theme` relationship of the main part, falling back to that path:
  - fonts from `a:theme/a:themeElements/a:fontScheme/a:majorFont|a:minorFont`, taking `a:latin|a:ea|a:cs@typeface` (empty string → null);
  - colours from `a:clrScheme/*`, where each child's `a:srgbClr@val` or `a:sysClr@lastClr` gives the hex.

  Core properties come from `docProps/core.xml` (`dc:title`, `dc:subject`, `dc:creator`, `cp:keywords`, `dc:description`, `cp:lastModifiedBy`, `cp:revision`).

Drop everything after folio's line 256 (`chainRunProps`, `paragraphBox`, the look), along with folio's `FAMILY_NAMES`/`foliqFontForPdfName` imports. Those reduce formatting to tokens.

### 3. `test/support/docx-fixture.ts`

Port folio's file, which is 53 lines; read it in full first. Change three things:

- Return `Uint8Array`, not `ArrayBuffer`.
- Add namespaces `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`, `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`, `xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"` and `xmlns:w10="urn:schemas-microsoft-com:office:word"` to `NAMESPACES`.
- Accept `{ body, styles?, numbering?, rels?, parts?, media?, theme?, footnotes?, comments?, core? }`. `theme` is the raw `a:theme` XML, written to `word/theme/theme1.xml`, with a theme relationship added. `footnotes`/`comments` are inner XML, wrapped in `w:footnotes`/`w:comments`, with relationships and content-type overrides added.

Keep `part(root, inside)` and `PICTURE`.

### 4. `test/read-package.test.ts` (AC3)

- **XML.**
  - `parseXml` + `serializeXml` reproduce `<w:p><w:r><w:t xml:space="preserve"> a &amp; b </w:t></w:r></w:p>` exactly.
  - An attribute with `"` and `&` round trips.
  - `parseXmlFragment("<w:fldChar w:fldCharType=\"begin\"/><w:instrText> PAGE </w:instrText>")` gives two elements.
- **Package.**
  - `openPackage` on a fixture finds `word/document.xml`.
  - It resolves an image relationship to `word/media/image1.png` and returns its bytes.
  - It resolves a header part's relationships from `word/_rels/header1.xml.rels`.
  - It keeps an external hyperlink target verbatim.
  - It reads theme fonts and colours from a minimal `a:theme` fixture, including an `a:sysClr` with `lastClr`.
  - It reads the core title.
- **Real files.** `openPackage` on `examples/resume.docx` (run `pnpm run examples` in a `beforeAll`, or render `CASES[0]` with `renderToBuffer`, preferably the latter so there is no file dependency) finds 10+ parts and an empty theme. docx.js writes no theme.
- **Errors.** `NotADocxError` for random bytes, for a zip without `[Content_Types].xml`, and for a zip without a main document.

## Verify

```sh
pnpm install
pnpm test -- test/read-package.test.ts
pnpm test
pnpm run type-check
```

## Watch out

- `htmlparser2`'s `parseDocument` in `xmlMode` decodes entities by default. Verify that `&amp;` comes back as `&` in text, and that `serializeXml` re-escapes it.
- `serializeXml` writes text escaped, never as CDATA, and only XML's five entities or character references. Phase 1 rejects any other named entity in RawXml (`&nbsp;`), and its writer turns authored CDATA into escaped text. So a RawXml holding CDATA reads back as equivalent escaped text: equal after one write, not before.
- Nothing in `src/read/` may import `docx` at runtime. `/reader` must stay docx-free (requirement 8).
- Do not import anything from folio; copy and adapt. folio is a separate repo, and its modules import `@foliq/*` packages.
