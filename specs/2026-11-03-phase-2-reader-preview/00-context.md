# react-docx phase 2: read `.docx` files, print them as JSX, preview them as HTML

> Master file for this effort. Every unit file assumes what is here and does not repeat it.
> **Read this first.**
> Generated from a working session on 2026-11-03.
> Audience: an engineer or agent with no prior context on this effort.
> Design: `specs/design/2026-11-03-document-tree-hub.md` holds the full argument behind the decisions below.
> Depends on: `specs/2026-11-03-phase-1-document-tree/`, all seven units landed.

## Goal

After phase 1, react-docx can turn JSX into a plain document tree and that tree into a Word file. Phase 2 adds the other three directions around the same tree:

- **Read.** `readDocx(bytes)` turns any `.docx` file into that tree, plus a list of everything it could not carry over.
- **Print.** `printJsx(tree)` turns the tree into a `.tsx` component file. A resume designed in Word becomes an editable React template.
- **Preview.** `<DocxPreview document={tree} />` shows the tree in a browser. This works for a read file and for authored JSX, and needs no `.docx` file and no docx.js in the browser.

When this is done, a person can:
- open their own Word resume through `pnpm run roundtrip resume.docx`;
- get back a `.docx` that looks the same, a report of what was dropped, a generated `Resume.tsx`, and an HTML preview.

## Background & Context

**What phase 1 leaves behind.** These are specified in `specs/2026-11-03-phase-1-document-tree/`. **Before unit 01 here, read that folder's `## Landed` section**, and if it records deviations, fix the affected units in this folder first.

- **`src/schema/elements.ts`** holds the element table `ELEMENTS` (a row per kind: `docx` class name, legal `children`, `text` flag, `ooxml` names), plus the types `Kind`, `Props<K>`, `Node<K>`, `DocumentNode`, `StylesProps` (with `importedStyles?: readonly string[]`), `DocumentProps`, `ImageProps`, and `NOT_MAPPED`.
  - The kinds: Document, Section, Header, Footer, Paragraph, TextRun, InsertedTextRun, DeletedTextRun, Table, TableRow, TableCell, Tab, PositionalTab, CarriageReturn, SoftHyphen, NoBreakHyphen, the six Day/Month/Year fields, PageNumber, ImageRun, SymbolRun, ExternalHyperlink, InternalHyperlink, Bookmark, PageBreak, ColumnBreak, SimpleField, SimpleMailMergeField, SequentialIdentifier, PageReference, CheckBox, Footnote, Comment, CommentRangeStart, CommentRangeEnd, CommentReference, TableOfContents, Textbox, Math, MathRun, RawXml.
  - The slot lists: `BLOCK` (Paragraph, Table, RawXml), `INLINE`, `RUN_CONTENT`.
- **`src/schema/docx-facts.ts`** holds `PAGE_NUMBER_VALUES`, `DEFAULT_STYLE_SLOTS` (docx.js's 13 built-in style ids → `styles.default.<key>`), `PRESENCE_ONLY` (booleans docx.js writes the same for `true` and `false`; the exact set is in phase 1 unit 03's Landed line) and `RAW_XML_ROOTS`.
- **`src/tree/canonical.ts`** holds `AuthorNode` (`{ type: string; props; children: (AuthorNode | string)[] }`), `TreeError` (with `.path`), and `canonicalize(root: AuthorNode): DocumentNode`. It is the only producer of canonical trees and enforces rules 1–19, among them:
  - strings are literal, and `PageNumber` is a node;
  - `TextRun.break` holds leading breaks only;
  - `heading` becomes `style`;
  - presence-only `false` values are stripped;
  - lists become numbered paragraphs;
  - a style using a docx.js default id is folded into `styles.default.<key>`;
  - RawXml must have allowed roots and no `r:` attributes;
  - a TableCell ends with a Paragraph;
  - Footnotes are inline and body-only;
  - Comment ids resolve.
- **`src/tree/render.ts`** holds `renderToTree(element)`, which is synchronous and works on React 18 and 19.
- **`src/write/`** holds `renderToBuffer`, `renderToBlob` and `renderToBase64`. Each accepts a React element or a tree.
- **`src/components.ts`** holds one exported component per kind.
- **Tests:**
  - vitest is set up, and `pnpm test` runs it.
  - `test/support/docx-xml.ts` has `docxXml(bytes)`, which unzips and normalizes XML.
  - `test/support/cases.tsx` exports `CASES`, about 20 JSX documents.
- **Scripts:** `pnpm run test:react` (the React matrix against `dist/`) and `pnpm run examples`.
- **Rule:** nothing under `src/schema/` or `src/tree/` imports docx.js at runtime.

**OOXML in one paragraph.** A `.docx` file is a zip, also called an OPC package.
- `word/document.xml` holds the body: `w:body` → blocks (`w:p` paragraph, `w:tbl` table, `w:sdt` content control) → inline content (`w:r` run, `w:hyperlink`, `w:bookmarkStart/End`, `w:fldSimple`, `w:ins`, `w:del`, `m:oMath`) → run content (`w:t` text, `w:tab`, `w:br`, `w:fldChar` + `w:instrText` complex fields, `w:drawing` images).
- Formatting sits in property elements: `w:pPr`, `w:rPr`, `w:tblPr`, `w:trPr`, `w:tcPr`, and `w:sectPr` for sections.
- **Sections.** A section ends at a paragraph whose `w:pPr` holds a `w:sectPr`. The last section's `w:sectPr` is the last child of `w:body`.
- **Other parts.** Styles are in `word/styles.xml` (`w:docDefaults` plus `w:style` elements with `w:basedOn` chains), list definitions in `word/numbering.xml` (`w:num` numId → `w:abstractNum` → `w:lvl`), the theme in `word/theme/theme1.xml`, and notes in `word/footnotes.xml` and `word/comments.xml`. Headers and footers are separate parts (`word/header1.xml`) referenced by `r:id` from `w:sectPr`.
- **Relationships.** `r:id`/`r:embed` attributes point through `word/_rels/<part>.rels` to targets: media, hyperlink URLs, header parts.
- **Units:**

| Unit | Used for |
|---|---|
| twips (1/20 pt) | spacing, indents, page size |
| half-points | font size |
| eighth-points | borders |
| EMU (914400 per inch, 12700 per pt, 9525 per px at 96 dpi) | drawings |
| 240ths of a line (`lineRule="auto"`) | line spacing |

**folio's reader, which this phase partly ports.** `/Users/silver/Desktop/Projects/my-libs/folio` is a separate repo and not a dependency.
- **Ported** (adapted, not imported): `packages/rebuild/docx-parts.ts` (567 lines) and `packages/rebuild/test/docx-fixture.ts` (53 lines). These cover unzip, rels, `zipPath`, part lookup, media, the style `basedOn` chain (capped at 10 hops), theme font typefaces, and core title.
  - Its stack is `fflate` `unzipSync`/`strFromU8`, `htmlparser2` `parseDocument(xml, { xmlMode: true })` and `domhandler`.
  - Element names keep their prefix (`el.name === "w:p"`), and attributes are read by full name (`el.attribs["w:val"]`).
- **Not ported:** `packages/rebuild/docx-body.ts` (1477 lines). It reduces formatting to theme tokens on purpose, and this reader must be faithful.
- **Lessons from folio's `context/dead-ends.md`:**
  - mammoth and docx-preview were tried and dropped.
  - Web pagination was built and removed, because "every measurement-driven paginator we tried disagreed with both exports".
  - Map headings by style *name* when names matter, because localized Word renames style ids. That doesn't apply here: this reader keeps ids verbatim.

**Verified docx.js 9.5.1 facts this phase relies on** (2026-11-03):
- `StyleForParagraph`/`StyleForCharacter` never write `w:default`, so docx.js options cannot express Word's default paragraph style (`w:default="1"`, usually `Normal`).
- `StyleForCharacter` adds `uiPriority: 99` and `unhideWhenUsed: true` when absent.
- docx.js writes no `word/theme/theme1.xml`.
- docx.js always writes its own numbering definition `default-bullet-numbering` (numId 1) and its 13 default styles.
- `doc.Styles.addChildElement(component)` appends raw `<w:style>` and keeps the defaults. Phase 1 unit 05 uses this.
- Image `transformation` is in pixels, written as EMU × 9525.
- `ImageRun` needs `type` (`"jpg" | "png" | "gif" | "bmp"`, or `"svg"` plus a raster `fallback`) and the bytes at construction.

**Versions.** `htmlparser2` 10.1.0 ships CommonJS and ESM builds (`exports` has `import` and `require`), so it works in both of our build formats. folio pins `fflate ^0.8.3`, `htmlparser2 ^10.1.0` and `domhandler ^5.0.3`, which are known to work together. LibreOffice is installed locally at `/opt/homebrew/bin/soffice`. `react-dom` 18.3.1 matches the repo's `react`.

**Terms.**
- **Canonical tree, author node, kind, sugar, presence-only boolean:** see phase 1's `00-context.md`.
- **Codec:** a function from one OOXML property element (`w:rPr`, …) to a docx.js option object, plus notes.
- **Fate:** what a codec does with each OOXML child element: `mapped`, `resolved`, `ignored` or `dropped`.
- **Diagnostic:** one entry in `readDocx`'s report.
- **Ordinal:** an id the reader assigns by order of first appearance, instead of copying the file's id.

## Requirements

1. **`readDocx(bytes: Uint8Array): ReadResult`** from `@react-docx/core/reader`. It is synchronous and browser-safe (no `Buffer`, `fs` or docx.js), and returns `{ document: DocumentNode, diagnostics: Diagnostic[] }`. It throws `NotADocxError` only when the bytes are not a Word package.
2. **The reader maps every OOXML element to a tree kind** where one exists. Otherwise it keeps the element verbatim as `RawXml`, unless the element carries `r:` relationship references.
3. **The reader maps every property docx.js can express.** Theme fonts and colours are resolved to literal values. Properties docx.js cannot express are dropped. Every resolution, drop and RawXml fallback produces a diagnostic with its part and tree path.
4. **The reader keeps style references.** Paragraphs keep `style="Heading1"`, and `styles.xml` becomes `Document.styles`. It does not flatten formatting onto runs.
5. **Round trip.** For any document react-docx wrote, `read(write(read(x)))` equals `read(x)`. For any Word-shaped fixture, the tree is stable after one write: `read(write(t2))` equals `t2`, where `t2 = read(write(read(x)))`.
6. **`printJsx(document, { componentName })`** from `@react-docx/core/codegen` returns `{ source, assets }`. The source is a `.tsx` module that renders the same canonical tree.
7. **`DocxPreview` and `resolveDocument`** from `@react-docx/core/html` render a canonical tree as HTML: section page width and margins, the style cascade, list markers and images. There is no pagination. `/html` re-exports `renderToTree`.
8. **Bundle isolation.** The `/html` and `/reader` bundles never import docx.js. The root bundle never imports fflate or htmlparser2.
9. **`pnpm run roundtrip <file.docx>`** writes the round-tripped `.docx`, the diagnostics, the generated `.tsx`, and an HTML preview for a real file.

## Decisions Made

| Decision | Rationale | Rejected alternatives & why |
|---|---|---|
| **1. Properties docx.js cannot express are dropped and reported.** The element keeps its mappable properties. A run or paragraph is never turned into RawXml because of one property. (User decision, 2026-11-03.) | Modern Word puts `w14:*` properties on most runs. Escalating would make most of a real resume RawXml: not editable in JSX, and not styled in the preview. | Escalate the enclosing element to RawXml: faithful, but not editable. Splice raw properties into docx.js's `rPr`: needs docx.js internals. |
| **2. Numbered paragraphs in headers and footers get their marker as literal leading text**, and the `numbering` prop is removed, with a `resolved` diagnostic. (User decision, 2026-11-03.) | docx.js registers numbering instances only for body paragraphs, so the numbering would be lost anyway. | The writer throws: then real files with such paragraphs could not round trip at all. |
| **3. The reader emits `AuthorNode`s and passes them through phase 1's `canonicalize`.** | One owner of canonical rules (phase 1 decision 4). | The reader emits canonical trees directly: a second implementation of every rule. |
| **4. The parser stack is fflate + htmlparser2 (xmlMode) + domhandler, converted at once into a plain `XmlElement` type** (`src/read/xml.ts`). Codecs and the HTML resolver see only `XmlElement`. | Plain data is easy to build in tests, and it is the same type whether it came from a file or from a RawXml string. Codecs stay parser-agnostic. | Pass domhandler nodes through: every codec would couple to domhandler. DOMParser: absent in Node and SSR. |
| **5. Every reader-assigned id is an ordinal of first appearance:** numbering references (`list-1`, `list-2`, …), list instances, comment ids. Footnote ids vanish, because Footnote is inline. | Source ids differ between Word and docx.js output, so copying them breaks the round trip. | Keeping source ids. |
| **6. Each codec has a fate table** for every child element of its property element: `mapped` (to a docx.js option), `resolved` (theme to literal), `ignored` (editing noise: `w:rsid*` attributes, `w:proofErr`, `w:lastRenderedPageBreak`, the `_GoBack` bookmark, `w:latentStyles`; counted, not listed) or `dropped`. An element not in the table is `dropped`. | Every property gets an explicit decision, and reports stay readable. | An implicit "map what we know, ignore the rest": silent loss, which contradicts faithfulness. |
| **7. Element fallback.** An OOXML element with no kind becomes `RawXml`, keeping its outer XML, if it contains no `r:` attribute. If it has `r:` attributes and is a wrapper (`w:sdt` → its `w:sdtContent`, `w:smartTag`, `w:customXml`, `mc:AlternateContent` → its `mc:Fallback`), the reader unwraps it, maps the content, and reports the wrapper `dropped`. Otherwise it is `dropped`. | Keeps everything that can be kept losslessly, and never writes a dangling relationship (phase 1 decision 10). | Dropping all unknown elements: loses content. RawXml with relationships: docx.js cannot write the targets (out of scope). |
| **8. Styles.** `w:docDefaults` → `styles.default.document`. Paragraph and character `w:style`s → `paragraphStyles`/`characterStyles` through the style codec, and `canonicalize` folds the 13 docx.js default ids into `styles.default.*`. **Raw `importedStyles` strings** hold: styles with `w:default="1"` (usually `Normal`, which docx.js cannot mark as default), table styles and numbering styles, none with `r:`. Styles no paragraph, run, table or style chain references are kept too, because Word users expect their style gallery. | Keeps styles editable as options where docx.js can express them, and lossless where it cannot. | Everything raw: no editable styles. `externalStyles` verbatim: overrides docx.js's styles wholesale, and gives codegen an opaque blob. |
| **9. Theme fonts and colours are resolved to literal values** with a `resolved` diagnostic. For example, `w:asciiTheme="minorHAnsi"` becomes the theme's minor Latin typeface, and `w:themeColor="accent1"` becomes the theme's accent1 hex. | docx.js writes no theme part, so a theme reference would resolve to Word's built-in theme, not the file's. | Keep the references: wrong colours after the round trip. |
| **10. The round-trip oracle comes in two strengths.** react-docx-written input must be an exact fixed point: `t1 = read(bytes)`, `t2 = read(write(t1))`, `t2` deep-equals `t1`. Word-shaped input only needs to be stable after one write: `t3` deep-equals `t2`. | docx.js normalizes some things on write (it adds `uiPriority: 99` to character styles, and writes its 13 default styles and its default bullet numbering), so a Word file's first read cannot equal its second. | Requiring `t2 = t1` for Word files: impossible without forking docx.js. |
| **11. Images.** `w:drawing` (`wp:inline` or `wp:anchor`) with `a:blip r:embed` becomes `ImageRun`, with bytes from the media part and `type` from the extension (`png`, `jpg`/`jpeg` → `jpg`, `gif`, `bmp`). An SVG (`asvg:svgBlip`) becomes `type: "svg"` with the raster blip as `fallback`. Size is `Math.round(EMU / 9525)` px. `wp:anchor` becomes `floating`. `a:srcRect` (crop) and effects are `dropped` and the image is kept uncropped. EMF, WMF and TIFF are `dropped`. | The closest docx.js expression. Writing crops needs raw XML with relationships (out of scope). | Images as RawXml: they need `r:embed`. |
| **12. Codegen** prints generic JSX `<Kind {...props}>children</Kind>`, imports components from `@react-docx/core` and enums from `docx` only where used, hoists `styles` and `numbering` to `const`s, writes image bytes as `assets/imageN.<ext>` read with `readFileSync(new URL("./assets/…", import.meta.url))`, and prints `RawXml` as a template literal. | Readable output that a person edits. Base64 inline would make a resume with a photo unreadable. | One string return: breaks with images. |
| **13. The HTML preview resolves to plain data first** (`resolveDocument(tree): ResolvedSection[]`), then a thin React component draws it. No pagination: one page box per section at the section width with margins as padding, the default header on top, the default footer at the bottom, and page breaks as `<hr data-docx-page-break>`. Every block carries `data-docx-path="0.3.1"`. | Testable without React, and folio's lesson on pagination. | Components that render DOM under an "html mode": numbering counters and style chains need a whole-document pass. |
| **14. The HTML style sheet** applies docx.js's own default styles, plus the document's. It comes from a generated snapshot (`src/html/docx-default-styles.generated.ts`), made by writing an empty docx.js document and reading it with this phase's reader. A test regenerates it and fails on drift. The authored `styles.default.<key>` is spread over the snapshot the way docx.js spreads it (shallowly). | Authored JSX uses `heading={HEADING_1}` without defining Heading1, but docx.js supplies 2E74B5 at 16pt, and the preview must match. Generating the snapshot through our own reader keeps it honest on docx.js upgrades. | A hand-copied table: drifts silently. |
| **15. `/html` may import htmlparser2, but never docx.js.** Raw `importedStyles` (table styles, `Normal`) are parsed at preview time with `parseXml` and read by the same codecs. | "Table Grid" borders and the `Normal` font must show in the preview. htmlparser2 is browser-safe and already a dependency. | No parser in `/html`: tables and body text would preview without their styles. |
| **16. Subpath exports.** `package.json` `exports` gains `./reader`, `./codegen` and `./html`, each with `types`/`import`/`require`. tsup builds the entries `index`, `reader`, `codegen` and `html`. `"sideEffects": false`. `fflate`, `htmlparser2` and `domhandler` become `dependencies` (installed for everyone, bundled only where imported). | Zero-config imports, and writer users never bundle parsers. | Optional peers: break zero-config `/reader`. |
| **17. Version bump and publish stay out of the units.** | The user's release decision (phase 1 decision 12). | |

## Current State

Phase 1 is assumed landed. Nothing in this phase is started. The design document exists. If phase 1's `## Landed` section shows a deviation, from a signature to a file path or rule, reconcile the affected unit here before running it.

## Out of Scope

- **Writing RawXml that needs relationships or new parts:** raw drawings, crops, charts, SmartArt, OLE. That is a later effort (phase 1 Out of Scope).
- **Word-accurate pagination in the preview.** Tried in folio and removed.
- **Reducing formatting to theme tokens.** That is folio's job.
- **folio adopting this reader.** A folio decision (user, 2026-11-03).
- **mammoth and docx-preview.** Tried by folio and dropped.
- **Endnotes.** `word/endnotes.xml` and `w:endnoteReference` are reported `dropped`, because docx.js cannot write them.
- **Showing headers and footers other than the default ones in the preview, and showing comments or tracked-change markup in the preview.** Comments are not drawn. Insertions render as normal text and deletions are not drawn.
- **`.doc` (binary Word 97), `.dotx`, `.docm` macros, `.odt`.** `readDocx` reads `.docx` packages only. A `.docm`'s `vbaProject.bin` is ignored with a `dropped` diagnostic.
- **The ~20 `Math*` structures as kinds.** OMML other than plain runs is RawXml (phase 1 Out of Scope).
- **Version bump, changelog, publish.**

## Acceptance Criteria

- **AC1.** `pnpm run type-check` exits 0.
- **AC2.** `pnpm run build` exits 0, and `dist/` contains `index`, `reader`, `codegen` and `html` in `.js`, `.mjs` and `.d.ts`.
- **AC3.** `test/read-package.test.ts` passes. It covers unzip, rels, `zipPath`, part lookup, media, theme fonts and colours, core title, `parseXml`/`serializeXml`, and the `NotADocxError` cases.
- **AC4.** `test/ooxml-run-paragraph.test.ts` passes, including the writer-inverse test: for each sampled `IRunOptions` and `IParagraphOptions` value, docx.js's output read back by the codec gives that value.
- **AC5.** `test/ooxml-table-section-style.test.ts` passes, including the writer-inverse test for table, row, cell, section, level and style options.
- **AC6.** `test/read-body.test.ts` passes. It covers paragraphs, runs, fields, hyperlinks, bookmarks, tables (merges), sections, headers and footers, styles, RawXml fallback, diagnostics and ordinals.
- **AC7.** `test/read-rich.test.ts` passes. It covers numbering and lists, header and footer markers, footnotes, comments and tracked changes.
- **AC8.** `test/read-objects.test.ts` passes. It covers images (inline, floating, SVG, crop dropped) with the writer-inverse test, VML images and text boxes, `mc:AlternateContent`, and math.
- **AC9.** `test/round-trip.test.ts` passes. Every phase-1 `CASES` entry is an exact fixed point (decision 10), every Word-shaped fixture is stable after one write, and so is every file in `test/fixtures/real/` if any are present.
- **AC10.** `pnpm run roundtrip examples/resume.docx` exits 0 after `pnpm run examples`, and writes `.roundtrip/resume/` with `roundtrip.docx`, `diagnostics.json`, `Resume.tsx`, `assets/` and `preview.html`.
- **AC11.** `test/codegen.test.ts` passes. For every round-trip fixture, the printed module, imported and rendered with `renderToTree`, deep-equals the tree it was printed from.
- **AC12.** `test/html-resolve.test.ts` passes. It covers the cascade, the default-style snapshot and its drift check, list markers, units → CSS, raw table and `Normal` styles, and images.
- **AC13.** `test/html-preview.test.tsx` passes. It renders through `react-dom/server` and checks `data-docx-path`, images, tables, markers and page breaks.
- **AC14.** `pnpm run check:bundles` exits 0. It builds, then proves requirement 8 by following each `dist/` entry's imports.

## Units

| # | File | What it changes |
|---|---|---|
| 01 | `01-xml-and-package.md` | `XmlElement`, `parseXml`/`serializeXml`, the OPC package layer ported from folio, the fixture builder |
| 02 | `02-run-paragraph-codecs.md` | `src/ooxml/` codec framework; `w:rPr` and `w:pPr` → docx.js options, with fate tables and the writer-inverse test |
| 03 | `03-table-section-style-codecs.md` | `w:tblPr`/`w:trPr`/`w:tcPr`, `w:sectPr`, `w:lvl`, `w:style` codecs |
| 04 | `04-reader-core.md` | The body walk (paragraphs, runs, fields, hyperlinks, bookmarks, tables, sections, headers/footers), styles, diagnostics, `readDocx`, the `/reader` subpath |
| 05 | `05-reader-lists-notes-changes.md` | Numbering and lists (with header/footer markers), footnotes, comments, tracked changes |
| 06 | `06-reader-images-objects.md` | Images (DrawingML and VML), text boxes, `mc:AlternateContent`, math |
| 07 | `07-round-trip.md` | The round-trip suite and the `roundtrip` script; the checkpoint on a real resume |
| 08 | `08-codegen.md` | `printJsx`, the `/codegen` subpath, `Resume.tsx` in `roundtrip` |
| 09 | `09-html-resolve.md` | The effective style sheet with its generated snapshot, `resolveDocument`, list markers, CSS units |
| 10 | `10-html-preview.md` | `DocxPreview`, the `/html` subpath, `check:bundles`, the `preview` script and `preview.html` in `roundtrip`; the checkpoint in a browser |

Run them in order. Each leaves the repo green on its own.

## Verification

```sh
pnpm install
pnpm run type-check
pnpm test
pnpm run build
pnpm run test:react
pnpm run examples
pnpm run roundtrip examples/resume.docx
pnpm run check:bundles
```

## Open Questions

- **Does Word continue counting across two `w:num`s that point at the same `w:abstractNum` with no `w:lvlOverride`?** Unit 05 maps each `w:num` to its own instance, which restarts in docx.js. If Word continues counting, unit 05 must give such `w:num`s one instance. Unit 07's checkpoint against a real file answers it. Unit 05 already handles it behind one function, so only that function changes.
- **Which real Word file should be the checkpoint?** Units 07 and 10 ask you to put one or more of your own `.docx` files in `test/fixtures/real/`, which is gitignored. Any resume made in Word works. Without one, the checkpoint uses `examples/resume.docx`, which docx.js wrote and so proves less.

## Landed

