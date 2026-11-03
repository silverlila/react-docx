# 04 — The reader core and `@react-docx/core/reader`

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC6. This unit adds the `reader` build entry; AC2 as a whole is claimed by unit 10, which adds the last entry.
- **You will see**:
  - `import { readDocx } from "@react-docx/core/reader"` works.
  - `readDocx(await renderToBuffer(<a phase-1 case>))` returns a tree with the same paragraphs, runs, tables, sections, headers, footers, fields, hyperlinks, bookmarks and styles.
  - The diagnostics list names every element it kept as RawXml or dropped, with the part and the block path.

## Goal

Read the body structure of a `.docx` into author nodes, using the unit 02–03 codecs for every property element, and pass the result through phase 1's `canonicalize`. That covers paragraphs, runs and run content, fields, hyperlinks, bookmarks, tables, sections, headers and footers, document properties, settings and styles.

Ship `readDocx` as the `/reader` subpath. Lists, images, notes, comments, tracked changes and math come in unit 05. Until then, each falls back to the generic rule (decision 7) or is reported as `dropped`, with the detail `"read in unit 05"`, which unit 05 removes.

## Files

- `src/read/diagnostics.ts`: new. `Diagnostic`, `TreePath`, and the collector (with ignored counts).
- `src/read/ordinals.ts`: new.
- `src/read/context.ts`: new. `ReadContext`.
- `src/read/fields.ts`: new. `w:fldSimple` and complex-field (`w:fldChar`) handling.
- `src/read/body.ts`: new. Blocks, paragraphs, inline content, runs, tables.
- `src/read/document.ts`: new. Sections, headers and footers, document properties, settings.
- `src/read/styles.ts`: new. `styles.xml` → `StylesProps`.
- `src/read/index.ts`: new. `readDocx` and the subpath's exports.
- `package.json`: `exports["./reader"]`.
- `tsup.config.ts`: the `reader` entry.
- `test/read-body.test.ts`: new (AC6).

## Changes

### 1. Diagnostics, ordinals, context

```ts
// src/read/diagnostics.ts
/** Child indices from the Document root to the nearest enclosing block (Section, Header, Footer, Paragraph, Table,
 *  TableRow, TableCell, Comment, Footnote). Block positions survive canonicalize; inline positions do not (Break splits). */
export type TreePath = readonly number[];
export type Diagnostic =
  | { readonly kind: "raw"; readonly part: string; readonly at: TreePath | null; readonly element: string; readonly detail: string }
  | { readonly kind: "resolved"; readonly part: string; readonly at: TreePath | null; readonly element: string; readonly detail: string }
  | { readonly kind: "dropped"; readonly part: string; readonly at: TreePath | null; readonly element: string; readonly detail: string }
  | { readonly kind: "ignored"; readonly element: string; readonly count: number };
```

- `part` is the zip path, such as `"word/document.xml"` or `"word/header1.xml"`.
- Codec `Note`s become diagnostics here, with the current part and path: `resolved` and `dropped` as themselves, `ignored` counted.
- The collector sorts by (part, path, element) before returning, so output is deterministic.

```ts
// src/read/ordinals.ts
export type Ordinals = { next(space: string, sourceKey: string): number };   // same (space, key) → same number; first seen = 1
// src/read/context.ts
export type ReadContext = {
  readonly pkg: OpcPackage; readonly env: CodecEnv; readonly ordinals: Ordinals;
  readonly part: string;                      // current part: rels resolve against it
  readonly at: TreePath;                      // current block path
  report(d: Omit<Diagnostic, "part" | "at"> & { kind: "raw" | "resolved" | "dropped" }): void;
  notes(notes: readonly Note[]): void;
  within(part: string | null, at: TreePath): ReadContext;
};
```

### 2. Blocks (`src/read/body.ts`)

`readBlocks(container: XmlElement, ctx): AuthorNode[]` works on `w:body`, `w:hdr`, `w:ftr` and `w:tc`.

| Element | Becomes |
|---|---|
| `w:p` | Paragraph (Change 3) |
| `w:tbl` | Table (Change 5) |
| `w:sdt`, `w:customXml` | the generic fallback (Change 7) |
| `w:bookmarkStart`/`w:bookmarkEnd` at block level | RawXml, with `w:id` rewritten as in Change 4 (`_GoBack` gives `ignored`) |
| `w:sectPr` | handled by `document.ts`, skipped here |
| `w:altChunk` | `dropped` (it carries `r:id`) |
| `w:proofErr`, `w:permStart`, `w:permEnd` | `ignored` |
| anything else | the generic fallback |

### 3. Paragraphs and inline content

A Paragraph's props are `readParagraphProperties(w:pPr).options`, with its notes reported. `numPr` gives `dropped` ("read in unit 05"). `sectPr` is returned to the section splitter.

`readInline` maps the children of `w:p`, `w:hyperlink`, `w:smartTag`, and so on:

| Element | Becomes |
|---|---|
| `w:r` | run content (Change 4) |
| `w:hyperlink` with `r:id` | `ExternalHyperlink { link: rel.target (+ "#" + w:anchor when both) }`, children read by `readInline`. A missing rel gives `dropped` and its content is unwrapped. `w:tooltip`, `w:history` and `w:tgtFrame` give one `dropped` note each, except `w:history`, which is `ignored` (docx.js always writes it) |
| `w:hyperlink` with `w:anchor` only | `InternalHyperlink { anchor }` |
| `w:fldSimple` | Change 6 |
| `w:bookmarkStart w:name="n"` … matching `w:bookmarkEnd` (same `w:id`) **in the same parent** | `Bookmark { id: n }` holding the inline content between. The `w:id` is not kept: docx.js gives each Bookmark its own id |
| a bookmark whose end is in another parent | the start and the end each become RawXml with `w:id` rewritten to `100000 + ordinals.next("bookmark", sourceId)`, and a `raw` diagnostic. Verified 2026-11-03: docx.js writes `w:id="1"` for every `Bookmark`, so raw ids need their own range |
| `_GoBack` bookmarks | `ignored` |
| `w:proofErr`, `w:permStart`, `w:permEnd` | `ignored` |
| `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `m:oMath`, `m:oMathPara`, `w:commentRangeStart`, `w:commentRangeEnd` | until unit 05, `w:ins`/`w:moveTo` content is unwrapped and `w:del`/`w:moveFrom` gives `dropped`; the others give `dropped` ("read in unit 05") |
| `w:sdt`, `w:smartTag`, `w:customXml`, `mc:AlternateContent` | the generic fallback |

### 4. Runs

A `w:r` becomes a `TextRun` with `readRunProperties(w:rPr).options`. Its content is walked in order, and some items **split** the run: the reader closes the current TextRun, emits the inline item, then continues in a new TextRun with the same props.

| Run content | Becomes |
|---|---|
| `w:t` | literal string (text verbatim) |
| `w:tab` | `Tab` |
| `w:br` (no `w:type`, or `textWrapping`) | author `Break` (canonicalize turns it into `break` counts). `w:clear` gives `dropped` |
| `w:br w:type="page"` | split, then `PageBreak` |
| `w:br w:type="column"` | split, then `ColumnBreak` |
| `w:cr` | `CarriageReturn` |
| `w:softHyphen`, `w:noBreakHyphen` | `SoftHyphen`, `NoBreakHyphen` |
| `w:ptab` | `PositionalTab { alignment, relativeTo, leader }` |
| `w:dayShort` … `w:yearLong` | their kinds |
| `w:sym` | split, then `SymbolRun { char: w:char, symbolfont: w:font, ...runProps }` |
| `w:fldChar`, `w:instrText` | Change 6 |
| `w:lastRenderedPageBreak` | `ignored` |
| `w:drawing`, `w:pict`, `w:object` | `dropped` ("read in unit 05") |
| `w:footnoteReference`, `w:endnoteReference`, `w:commentReference`, `w:annotationRef`, `w:footnoteRef`, `w:separator`, `w:continuationSeparator` | `dropped` ("read in unit 05") |
| anything else | the generic fallback (Change 7) in run position |

An empty TextRun is dropped from the output unless it carries `break`.

### 5. Tables

- `w:tbl` → `Table { ...readTableProperties(tbl).options }`.
- `w:tr` → `TableRow { ...readRowProperties(trPr).options }`.
- `w:tc` → `TableCell { ...readCellProperties(tcPr).options }`, whose children are `readBlocks(tc)`.
- `w:tblPrEx` gives `dropped`.
- `w:sdt`/`w:customXml` around rows or cells are unwrapped (rows and cells cannot be RawXml), with the wrapper `dropped`.
- If a TableCell's last child would be RawXml or a Table, append an empty `Paragraph`. OOXML requires a cell to end with a paragraph, and canonical rule 15 enforces it. Word files always comply, so this is a guard and is not reported.

### 6. Fields (`src/read/fields.ts`)

**Page fields.** These map:

| Instruction | `PageNumber.field` |
|---|---|
| `PAGE` | `"CURRENT"` |
| `NUMPAGES` | `"TOTAL_PAGES"` |
| `SECTIONPAGES` | `"TOTAL_PAGES_IN_SECTION"` |
| `SECTION` | `"SECTION"` |

The instruction is trimmed, its first token uppercased, and the only allowed switch is `\* MERGEFORMAT`. These are exactly what docx.js writes (`node_modules/docx/dist/index.mjs`, classes `Page`, `NumberOfPages`, `NumberOfPagesSection`, `CurrentSection`). With any other switch, the field is not a page field.

**`w:fldSimple`.**
- With a page-field instruction, it becomes `TextRun { ...props of its first inner w:r }` with child `PageNumber`. The cached result is `ignored`.
- Otherwise it becomes RawXml in inline position: `serializeXml(fldSimple)`, if it has no `r:` attribute, else its content is unwrapped and reported `dropped`.

**Complex fields.** A complex field is `w:fldChar w:fldCharType="begin"` … `w:instrText` … `"separate"` … result … `"end"`, possibly spread over several runs. Collect it from begin to the matching end, counting nested begin/end pairs.
- A page-field instruction becomes a single `TextRun { props of the run holding the instrText }` with child `PageNumber`. The cached result is `ignored`.
- Any other field becomes one RawXml in inline position, holding every `w:r` from the begin run to the end run, serialized in order. This only happens when the serialized runs pass `rawXmlOf` (Change 7); otherwise the result runs are read normally, so the cached text stays visible, and the field code is reported `dropped`.
- If begin and end fall in the same run (docx.js writes them that way), the split rules of Change 4 still apply around it.

### 7. The generic fallback (decision 7)

`fallback(el, slot: "block" | "inline" | "run", ctx)`:

1. If `el.name` is in `RAW_XML_ROOTS[slot]` and `rawXmlOf(serializeXml(el))` accepts it → `RawXml { xml }`, with a `raw` diagnostic.

   `rawXmlOf(xml)` is the one gate every RawXml the reader emits goes through, here, in fields (Change 6) and for raw styles (unit 03). It accepts a fragment only when it has no `r:` attribute (deep) and phase 1's `xmlRoots(xml)` returns `kind: "roots"`. `"malformed"` or `"unwritable"` means canonicalize would throw. That happens with vendor XML that holds text beside child elements, which docx.js cannot write. Such an element is not RawXml: it goes to step 2 or 3, and the diagnostic carries `xmlRoots`' reason.
2. Else, if `el` is a wrapper → read its content in the same slot (`w:sdt` → `w:sdtContent`, `w:smartTag`/`w:customXml` → their children, `mc:AlternateContent` → `mc:Fallback`), with the wrapper reported `dropped`.
3. Else → `dropped`.

### 8. Sections, headers, footers, document (`src/read/document.ts`)

**Sections.**
- Walk `w:body`'s blocks, ending a section after each `w:p` whose `w:pPr` holds a `w:sectPr`. That paragraph belongs to the section it ends. The final section uses `w:body/w:sectPr`.
- Each section becomes `Section { ...readSectionProperties(sectPr).options }`.
- For each reference: `rel = pkg.relsOf(mainPart).get(relId)`, part `pkg.part(rel.target)` (root `w:hdr` or `w:ftr`), children `readBlocks(root, ctx.within(rel.target, at))`. That gives a `Header { type }` or `Footer { type }` child, placed before the body blocks.
- A section with no references gets none. Word inherits the previous section's header, and docx.js writing none keeps that.

**Document props.**
- `title`, `subject`, `creator`, `keywords`, `description`, `lastModifiedBy` and `revision` come from `pkg.core`.
- `customProperties` comes from `docProps/custom.xml`, as `vt:lpwstr` values only. Other value types are `dropped`.
- `background: { color }` comes from `w:document/w:background@w:color`.
- From `word/settings.xml`:
  - `w:evenAndOddHeaders` → `evenAndOddHeaderAndFooters`;
  - `w:defaultTabStop` → `defaultTabStop`;
  - `w:updateFields` → `features.updateFields`;
  - `w:trackRevisions` → `features.trackRevisions`;
  - every other settings child → one `ignored` count per element name. Settings are editor state; docx.js writes its own.
- `styles` comes from Change 9.

**Unread parts.** Every zip path that no reader consumed gets one `dropped` diagnostic with `element: <path>`, for example `word/endnotes.xml`, `word/glossary/document.xml` or `customXml/item1.xml`. These are excluded:
- the content-types and rels files;
- `docProps/app.xml`;
- `word/fontTable.xml` and `word/webSettings.xml`, which are `ignored`;
- parts that unit 05 reads.

### 9. Styles (`src/read/styles.ts`)

```ts
export function readStylesPart(ctx: ReadContext): StylesProps | undefined;
```

- `default.document` = `readDocDefaults(w:docDefaults)`.
- For each `w:style`, `readStyle`:
  - `paragraph` → `paragraphStyles`. The style's `numPr` gives `dropped` ("read in unit 05").
  - `character` → `characterStyles`.
  - `raw` → `importedStyles`.
  - `dropped` → a diagnostic.
- `w:latentStyles` gives `ignored`.
- Keep the file's order within each list.

A `paragraphStyles` entry whose id is a docx.js default (Heading1, Title, …) is folded into `styles.default.*` by canonicalize rule 12. Do not fold it here.

### 10. `readDocx` and the subpath (`src/read/index.ts`)

```ts
export type ReadResult = { readonly document: DocumentNode; readonly diagnostics: readonly Diagnostic[] };
export function readDocx(bytes: Uint8Array | ArrayBuffer): ReadResult;
export { NotADocxError } from "./package";
export type { Diagnostic, TreePath } from "./diagnostics";
```

`openPackage` → build the `Document` author node → `canonicalize`. If canonicalize throws `TreeError`, rethrow it as `new Error(\`readDocx produced an invalid tree (a reader bug): ${e.message}\`, { cause: e })`.

**Packaging.**
- `package.json` `exports` gains `"./reader": { "types": "./dist/reader.d.ts", "import": "./dist/reader.mjs", "require": "./dist/reader.js" }`, and `"sideEffects": false`.
- `tsup.config.ts`'s `entry` becomes `{ index: "src/index.ts", reader: "src/read/index.ts" }`.
- Keep `format: ["cjs", "esm"]`, `dts: true` and the externals. Add `"fflate"`, `"htmlparser2"` and `"domhandler"` to `external`, though they are already externalized as dependencies.

### 11. `test/read-body.test.ts` (AC6)

Build inputs with `test/support/docx-fixture.ts`, and assert on `readDocx(...).document` and `.diagnostics`:

- **Runs and text.**
  - `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hi</w:t><w:tab/><w:t>there</w:t></w:r></w:p>` gives one Paragraph > TextRun `{ bold: true }` with children `["Hi", Tab, "there"]`.
  - `<w:br/>` mid-run gives two TextRuns, the second with `break: 1`.
  - `<w:br w:type="page"/>` gives `[TextRun, PageBreak, TextRun]`.
- **Fields.**
  - A complex `PAGE` field over five runs gives `TextRun > PageNumber CURRENT`.
  - `NUMPAGES \* MERGEFORMAT` gives `TOTAL_PAGES`.
  - A `DATE \@ "d MMMM yyyy"` field gives one inline RawXml holding all its runs, plus a `raw` diagnostic.
- **Hyperlinks.**
  - An external hyperlink gives `ExternalHyperlink { link }` from the rel.
  - In a header, the hyperlink's rel resolves against `word/_rels/header1.xml.rels`.
  - An internal hyperlink gives `InternalHyperlink`.
- **Bookmarks.**
  - A same-paragraph bookmark gives `Bookmark { id: name }`.
  - A cross-paragraph bookmark gives two RawXml with `w:id="100001"`.
  - `_GoBack` gives `ignored`.
- **Tables.** A two-row table with `w:gridSpan` and `w:vMerge` restart/continue gives the TableCell props `columnSpan` and `verticalMerge`, and the cell count equals the `w:tc` count.
- **Sections.**
  - Two sections split by a paragraph `w:sectPr` give two Sections with the right paragraphs and `properties.page`.
  - Default and first headers and a default footer give Header/Footer children with their content.
- **Styles.**
  - `Normal` with `w:default="1"` goes to `importedStyles`.
  - `Heading1` lands in `styles.default.heading1`, through canonicalize.
  - A custom `MyStyle` stays in `paragraphStyles`, and `Paragraph.style === "MyStyle"`.
- **Fallback.**
  - A `w:sdt` with no `r:` gives block RawXml.
  - A `w:sdt` containing a hyperlink with `r:id` gives its content mapped and `dropped` for `w:sdt`.
  - `<w:foo/>` gives `dropped`.
  - `w:rsidR` attributes produce nothing.
  - `w:proofErr` gives `ignored` with a count.
- **Phase-1 cases.** For every phase-1 `CASES` entry, `readDocx(await renderToBuffer(el))` does not throw. Unit 06 tightens this to exact equality.
- **Paths.** A dropped element in the second paragraph of the first section has `at: [0, 1]`.

## Verify

```sh
pnpm test -- test/read-body.test.ts
pnpm test
pnpm run type-check
pnpm run build && ls dist/reader.mjs dist/reader.js dist/reader.d.ts
```

## Watch out

- Keep run splitting in the reader to what OOXML forces: page breaks, column breaks, symbols and fields. Leave `w:br` text breaks to canonicalize (author `Break`), so one rule owns break counting.
- The `r:` check must look at the whole subtree, because a `w:sdt` can hide a hyperlink three levels down. Write `hasRelationship(el): boolean` once, in `src/read/xml.ts` or `body.ts`.
- `readDocx` must not import docx at runtime: `grep -rn 'from "docx"' src/read | grep -v "import type"` must print nothing.
