# react-docx core: one canonical document tree, React 18 + 19, full docx.js writer coverage

> Master file for this effort. Every unit file assumes what is here and does not repeat it.
> **Read this first.**
> Generated from a working session on 2026-11-03.
> Audience: an engineer or agent with no prior context on this effort.
> Design: `specs/design/2026-11-03-document-tree-hub.md` holds the full argument behind the decisions below, for anyone who wants to reopen one.

## Goal

Today react-docx turns JSX into a Word file through a chain of hand-written classes and if-chains, and that chain only works on React 18. When this effort is done:

- **There is a document tree as plain data.** Every JSX document first becomes a "canonical document tree" of plain objects, and only then a `.docx` file. Every rule about what a document may contain lives in one table and one function.
- **It works on React 18 and 19.** The same package works in a React 18 app (folio, the sibling app that depends on this library) and in a React 19 app.
- **The writer covers the rest of docx.js.** That means footnotes, comments, a table of contents, text boxes, fields, tracked changes, check boxes and the smaller run elements. There is also a `RawXml` escape hatch for anything docx.js cannot express.
- **Four writer bugs are fixed.** Lists restart and nest. `Math` keeps its text. `SymbolRun` keeps its formatting. A Tab inside a TextRun stops producing invalid XML.
- **Existing output does not change.** The library has a test suite that proves output folio depends on is byte-for-byte unchanged.

This is phase 1 of two. Phase 2 (`specs/2026-11-03-phase-2-reader-preview/`) adds a `.docx` reader, a JSX source printer and an HTML preview on top of this tree. Phase 2 is written against what this phase is specified to leave behind. If a unit here has to deviate from a signature, file path or rule it names, record the deviation in its `## Landed` line, so that the phase-2 review can catch it.

## Background & Context

**The project.** `@react-docx/core` 0.1.8 is published on npm. It is a React custom renderer (built with the `react-reconciler` package) over **docx.js** (the `docx` npm package, 9.5.1 installed), which writes `.docx` files. Users write `<Document><Section><Paragraph><TextRun bold>Hi</TextRun></Paragraph></Section></Document>` and call `renderToBuffer(element)`. Props are docx.js option objects verbatim (`IParagraphOptions`, `IRunOptions`, …). That rule is the project's identity: see "Direct DOCX API Mapping" in `CLAUDE.md`, which is gitignored but present locally.

**The pipeline today.**

```
JSX ─► src/components/*.tsx            createElement("RDParagraph", props, children), 17 files
    ─► src/reconciler-v19.ts           host config; switch(type) → new ParagraphNode(props) …
    ─► src/nodes.ts                    21 MutableNode subclasses {nodeType, props: any, children}
    ─► src/renderer.ts                 createContainer (8-arg, react-reconciler 0.29), ensureNumberingConfig
    ─► src/transformers/docx-transformer.ts   instanceof if-chain → new docx.Paragraph({...props, children})
    ─► docx.Packer.toBuffer
```

- **Each element is described in five places:** a class in `nodes.ts`, the union in `src/types.ts`, the reconciler switch, the transformer branch, and a component file.
- **Normalization is mixed into docx.js construction.** For example, `transformTab` wraps a Tab in a run, and `transformSection` merges `props.headers` with Header children.
- `src/reconciler-v19.ts` is misnamed. It runs on react-reconciler 0.29.0, which needs React 18.

**Verified current behavior.** Each item was reproduced on 2026-11-03 by rendering through `src/index.ts` with `npx tsx` and unzipping `word/document.xml`.

| Input | Output today | Why it is wrong |
|---|---|---|
| `<TextRun>a<Tab/>b</TextRun>` | `<w:r><w:t>a</w:t><w:r><w:tab/></w:r><w:t>b</w:t></w:r>` | a run nested in a run is invalid OOXML |
| `<Math text="x+1"/>` | `<m:oMath/>` | the text is ignored |
| `<SymbolRun char="F071" symbolfont="Wingdings" bold/>` | `<w:r><w:sym w:char="F071" w:font="Wingdings"/></w:r>` | only `char` is passed; Wingdings is docx's default font, `bold` is lost |
| two `<List type="numbered">` | both paragraphs use `w:numId="2"` | the second list continues the first instead of restarting |
| `<List type="numbered" level={1}>` | `w:ilvl="1"` | `DEFAULT_NUMBERING` (`src/constants.ts`) defines only level 0 |
| `<Paragraph heading={HeadingLevel.HEADING_1} style="Heading1">` | two `<w:pStyle w:val="Heading1"/>` | docx.js emits both |
| `styles.paragraphStyles: [{ id: "Heading1", … }]` | `word/styles.xml` has 2 `w:styleId="Heading1"` | docx.js adds its own default Heading1 too |

**docx.js facts the units rely on.** All of these were verified against `node_modules/docx/dist/index.d.ts` and `index.mjs`, version 9.5.1.

- **Some classes are not exported.**
  - The `Break` class is not exported (`"Break" in require("docx") === false`). `TextRun`'s `break: n` option emits n `<w:br/>` before all children.
  - `ImportedXmlComponent.fromXmlString` is broken: it emits an `<undefined>` wrapper. The working path is `convertToXmlComponent(xml2js(str, { compact: false }).elements[i])`. `xml-js` is a real `dependencies` entry of docx (`node_modules/docx/package.json`) and is not re-exported.
- **Strings in run `children` are sniffed as fields.** A string child of a run that equals a `PageNumber` value (`"CURRENT"`, `"TOTAL_PAGES"`, `"TOTAL_PAGES_IN_SECTION"`, `"SECTION"`) becomes a field. folio relies on this (`<TextRun children={[PageNumber.CURRENT]} />`).
- **Numbering.**
  - A paragraph's `numbering: { reference, level, instance? }` picks a list. Each distinct `(reference, instance)` pair gets its own `w:num`, and a new `instance` restarts numbering.
  - Unless `style` or `custom: true` is set, docx adds `pStyle=ListParagraph`.
  - Numbering instances register only for paragraphs in the document body, not in headers or footers.
- **Default styles.** docx.js's default style list (`DefaultStylesFactory`, about line 17179 of `index.mjs`) always contains these ids: `Title, Heading1–Heading6, Strong, ListParagraph, Hyperlink, FootnoteReference, FootnoteText, FootnoteTextChar`. Each default is built as `new Heading1Style({ run: {color, size}, ...options.heading1 })`, where `Heading1Style` spreads options over `{ id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true }`. `IBaseParagraphStyleOptions` includes `name/basedOn/next/…`. So putting a user style with id `Heading1` into `styles.default.heading1` reproduces it exactly, with one definition. `HeadingLevel.HEADING_1 === "Heading1"`, and likewise for the others; `TITLE === "Title"`.
- **Constructor shapes for the new elements:**
  - `FootnoteReferenceRun(id: number)`
  - `CommentRangeStart/CommentRangeEnd/CommentReference(id: number)`
  - `TableOfContents(alias?, properties?: ITableOfContentsOptions)`
  - `Textbox(ITextboxOptions)` (`ITextboxOptions = Omit<IParagraphOptions,"style"> & {…}`)
  - `CheckBox(options?: ICheckboxSymbolOptions)`
  - `InsertedTextRun(IInsertedRunOptions)` and `DeletedTextRun(IDeletedRunOptions)`. Both option types are declared but not exported; derive them with `ConstructorParameters<typeof docx.InsertedTextRun>[0]`. The same applies to `ITextboxOptions`.
  - `SimpleField(instruction, cachedValue?)`, `SimpleMailMergeField(fieldName)`, `SequentialIdentifier(identifier)`
  - `PositionalTab(PositionalTabOptions)`, `MathRun(text)`, `ColumnBreak()`, `PageReference(bookmarkId, options?)`
  - Footnotes: Document `footnotes: Record<id, { children: Paragraph[] }>`. Comments: Document `comments: { children: ICommentOptions[] }`.
  - `Packer.toBase64String` exists.
- **Output is deterministic except for three things.**
  - External hyperlink relationship ids (`r:id="rId<random>"` in `word/document.xml` and `word/_rels/document.xml.rels`).
  - The timestamps in `docProps/core.xml`.
  - Image media names, which are content hashes and are stable.

  To reproduce: run `npx tsx examples/advanced.tsx` twice and compare entries with `cmp <(unzip -p a1.docx word/document.xml) <(unzip -p a2.docx word/document.xml)`.

**React reconciler facts** (verified 2026-11-03 in a scratch project; see unit 02):

- react-reconciler 0.29.x runs only on React 18, 0.31.0 on React 19.0–19.1, and 0.33.0 on React 19.2 and later. 0.33.0 was verified working on 19.2.0 and 19.3.1, the latest React. Each build reads React internals only when its factory is called, so importing all three into one module is safe under any React version.
- 0.31 and later have no legacy root. A synchronous render is `createContainer` with 10 arguments, then `updateContainerSync`, then `flushSyncWork`. Render errors arrive through the `onUncaughtError` callback and must be rethrown.
- On 0.29, `updateContainer` on a legacy root (tag 0) is synchronous and throws render errors directly.
- esbuild/tsup **cannot bundle** a reconciler into the ESM output: the result throws `Dynamic require of "react" is not supported`. The reconcilers must therefore stay external runtime dependencies.

**folio, the caller that cannot break.** It lives at `/Users/silver/Desktop/Projects/my-libs/folio`, a separate repo on React `^18.3.1`, and depends on `@react-docx/core ^0.1.8`.

- **What it uses:** `Document, Section, Header, Footer, Paragraph, TextRun, Tab, Break, PageBreak, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, renderToBlob, renderToBuffer`.
- **Props it relies on:**
  - `heading=` (in `packages/dsl/render/docx/heading.tsx`)
  - `styles.default.document` and `styles.default.heading1..4` (in `packages/dsl/render/docx/shared.tsx`, `buildStyles`)
  - `<TextRun children={[PageNumber.CURRENT]} />`
- **How it walks trees:** it matches components by identity (`ofType(tree, Table)` is `el.type === Table`), so every exported component must stay one stable module-level constant.
- **What it does not use:** `List`, nor any prop this effort removes.

**Terms.**

- **Canonical tree.** The plain-data `{ type, props, children }` tree described in *Decisions Made*, row 1.
- **Author node.** The unnormalized `{ type, props, children }` the reconciler builds from JSX, before `canonicalize`.
- **Kind.** An element name in the element table (`"Paragraph"`, `"TextRun"`, …).
- **Sugar.** An authoring-only element that `canonicalize` expands and that never appears in a canonical tree: `List`, `ListItem`, `Break`.
- **Presence-only boolean.** A docx.js boolean option that is written to the XML whenever it is present, even as `false`. Example: `tableHeader={false}` still emits `<w:tblHeader/>`.

**Repo commands as they exist on 2026-11-03.** `package.json` scripts:

- `build` (tsup)
- `dev`
- `type-check` (`tsc --noEmit`, covers `src/**` only)
- `test` (`echo "Tests coming soon"`, replaced in unit 01)
- `run-example`

`pnpm run type-check` and `pnpm run build` both exit 0 today. All four examples run from the repo root (`npx tsx examples/<name>.tsx`) and write `examples/<name>.docx`. The release workflow (`.github/workflows/release.yaml`) runs `pnpm install --frozen-lockfile` and `pnpm run build` on Node 24. Local tooling: Node 25.2.1, pnpm 10.23.0.

## Requirements

1. **Delete the dead VS Code extension and its leftovers:** `plugins/`, `pnpm-workspace.yaml` (it only lists `.` and `plugins/*`), `src/transformers/html-transformer.ts`, `src/transformers/dom-transformer.ts`, and the devDependencies `@babel/*`, `mammoth` and `@react-docx/core` (a self-dependency). Add `examples/*.docx` to `.gitignore`.
2. **Add a real test suite.** `pnpm test` runs vitest.
3. **Pin today's output before changing internals.** A characterization test records normalized writer output for every component folio uses, plus the buggy cases, before internals change.
4. **One package renders under React 18.x and React 19.x.** A matrix check proves 18.3.1, 19.0.0, 19.1.0, 19.2.0 and 19.3.1 against the built `dist/`.
5. **One element table** (`src/schema/elements.ts`) declares every kind: its props type, its legal children, and the docx.js class it builds.
6. **One `canonicalize` function** (`src/tree/canonical.ts`) is the only producer of canonical trees and enforces every invariant in *Decisions Made*.
7. **`renderToTree(element)`** is exported from the package root and returns the canonical tree synchronously. It throws `TreeError` with a path such as `["Document", "Section[0]", "Paragraph[3]"]` when an element is misplaced.
8. **`renderToBuffer`, `renderToBlob` and `renderToBase64` accept either a React element or a canonical tree**, and produce the same document for both. `renderToBase64` must not use Node's `Buffer`.
9. **folio's output does not change.** Its components, `heading=`, `styles.default.*` and `PageNumber` children produce byte-identical normalized XML before and after.
10. **The four writer bugs in the Background table are fixed**, along with the duplicate `pStyle` and the duplicate style definition.
11. **Add every docx.js content element not yet covered:** `Footnote`, `Comment`, `CommentRangeStart`, `CommentRangeEnd`, `CommentReference`, `TableOfContents`, `Textbox`, `ColumnBreak`, `SimpleField`, `SimpleMailMergeField`, `SequentialIdentifier`, `PageReference`, `CheckBox`, `InsertedTextRun`, `DeletedTextRun`, `PositionalTab`, `CarriageReturn`, `SoftHyphen`, `NoBreakHyphen`, `DayShort`, `DayLong`, `MonthShort`, `MonthLong`, `YearShort`, `YearLong`, `MathRun`, and the `RawXml` escape hatch.
12. **A coverage test fails** when docx.js exports a content class that is neither a kind in the table nor listed in `NOT_MAPPED` with a reason.

## Decisions Made

| Decision | Rationale | Rejected alternatives & why |
|---|---|---|
| **1. The plain-data canonical tree `{ type, props, children }` is the hub.** Every input produces it and every output reads it. This effort builds the JSX → tree → docx.js half. Props are plain data: JSON values, `Uint8Array` for image bytes, `Date` for dates. No class instances. | The reader, JSX printer and HTML preview (effort 2) need one tree they can produce, compare and walk. Class instances do not survive deep equality, `structuredClone` or a reader that builds plain objects. | Keep the `MutableNode` classes with `props: any`: typed props are impossible and the grammar stays in `instanceof` chains. |
| **2. Props are docx.js option shapes verbatim. There is no style-transformation layer.** | It is the project's founding rule, and users read docx.js documentation directly. | A CSS-like `style` prop. |
| **3. One data-only element table (`src/schema/elements.ts`)** declares every kind's props type, legal child kinds, whether it holds literal strings, its docx.js class name, and its OOXML names. Each direction (writer now; reader and HTML later) has its own exhaustive `{ [K in Kind]: … }` record that the compiler checks against that table. | One place states what a kind is. Adding a kind without a builder fails to compile. | One object per element carrying writer, reader and HTML functions: object fields cannot be tree-shaken, so writer users would bundle the parser and the browser preview would bundle docx.js. |
| **4. `canonicalize` is the single gate into the tree** (`src/tree/canonical.ts`). JSX goes through it now, and the reader goes through it in effort 2. | Every canonical rule has one owner, so the writer handles one shape per meaning. | Validate placement in one function and keep normalizing inside the writer: two owners of the canonical form, which is exactly today's fault. |
| **5. The canonical invariants** (all established by `canonicalize`): see the list after this table. | Each removes a second way to say one thing, which the writer, the future reader round trip and the future printer would otherwise all handle. | Throwing on `TextRun` with both `text` and children: canonicalization keeps both, instead of inheriting docx.js's silent drop of `text`. A `Break` run-content node written as raw `<w:br/>` XML: puts RawXml in the writer for a common element. |
| **6. React 18 and 19 in one package.** Three reconcilers are installed as aliased runtime dependencies: `react-reconciler-29` → `react-reconciler@0.29.0`, `react-reconciler-31` → `0.31.0`, `react-reconciler-33` → `0.33.0`. The line is picked at runtime from `React.version`: 18.x → 29; 19.0 and 19.1 → 31; 19.2 and later in the 19 line → 33. Any other version throws `react-docx supports React 18 and 19, found <v>`. Rendering is synchronous on every line. Peer range becomes `react: "^18.2.0 \|\| ^19.0.0"`. | folio is on React 18 and new apps are on 19. @react-pdf/reconciler ships the same way. Synchronous rendering keeps `renderToTree` a plain function. | Separate package majors per React line (r3f, ink, konva): two publish tracks for one host config. Async `renderToTree` with a dynamic import of one reconciler: forces `use(promise)` into every future live preview. **Bundling the reconcilers into `dist/`** (the design document's wording): verified broken in ESM output (`Dynamic require of "react" is not supported`). |
| **7. Duplicate style ids are resolved by `canonicalize`.** A `paragraphStyles`/`characterStyles` entry whose id is one of docx.js's 13 default style ids moves into `styles.default.<key>`, without its `id`, replacing any `styles.default.<key>` already there. | docx.js spreads `default.<key>` over the fixed id and name, so this is lossless and yields one definition. folio's `styles.default.*` path stays byte-identical. | The design document's "writer always passes a complete effective style sheet built from a generated snapshot of docx.js's defaults": it would replace docx.js's default handling that folio depends on, and the snapshot needs XML property parsing that only exists in effort 2. The effective-sheet module moves to effort 2, where the HTML resolver needs it. |
| **8. docx-instance props become child nodes.** `Section.headers/footers` (instances) are removed in favor of `<Header>`/`<Footer>` children, which already exist since 0.1.8. `Document.footnotes` is replaced by an inline `<Footnote>`. `Document.comments` is replaced by `<Comment>` children of Document. `Document.externalStyles` is removed. | A plain tree cannot hold docx instances, and headers had two sources of truth. folio uses none of these props (checked in `folio/packages/dsl/render/docx`). | Keep both forms: two sources of truth for one header. |
| **9. Footnotes are inline nodes.** `<Footnote>` sits where it is referenced and holds its paragraphs. The writer numbers footnotes 1..n in body order. | A footnote id cannot dangle because the tree has none, and authoring reads naturally. | Document-level footnote list plus `FootnoteReferenceRun(id)`: ids that can dangle. |
| **10. `RawXml` holds an XML string** (`{ xml: string }`), with one or more sibling OOXML elements, legal in block, inline and run positions. The writer converts it with `xml-js` + `convertToXmlComponent`. Authored RawXml containing any `r:` relationship attribute (`r:id`, `r:embed`, `r:link`, …) makes the writer throw. | A string stays readable in printed JSX (effort 2) and costs nothing (`xml-js` already ships with docx). docx.js cannot carry relationships for raw fragments. | Pre-parsed XML element objects: the writer stays parser-free, but printed JSX becomes unreadable and needs a tagged template from the reader subpath. |
| **11. Lists.** `<List type>` and `<ListItem>` are sugar. Each top-level `List` gets the next `instance`, and nesting depth sets `level`. `DEFAULT_NUMBERING` (still exported, same `reference` names `"NumberedList"` and `"BulletList"`) defines levels 0–8. The `List.level` prop is removed. | Restart and nesting work. Existing references keep working for users who pass `DEFAULT_NUMBERING` explicitly (`examples/basic.tsx` does). | Keep `level`: nesting already says it, and two sources disagree. |
| **12. Breaking changes ship as 0.2.0, but this effort does not bump or publish.** The changes are the removed props from rows 8 and 11, `<Math text>` now produces `MathRun`, `styles.importedStyles` takes XML strings instead of docx components (unit 05), docx peer `^9.5.0`, and React 16/17 dropped. | Publishing is a release decision for the user, and folio pins the version in five `package.json` files. | Bump inside a unit. |
| **13. Tests assert on normalized output XML, not on docx.js objects.** | XML is what Word reads, and it survives the internal rewrite unchanged. folio asserts on objects, which is why it cannot be reused here. | Asserting on `docx.Paragraph` option bags: would all break in unit 04. |

**Canonical invariants (decision 5).**

- **Strings in children are always literal text.** A page-number field is a `PageNumber` node. An authored string child that equals a `PageNumber` value becomes a `PageNumber` node, which keeps folio working. Adjacent strings are merged.
- **The `text` prop on `TextRun` or `Paragraph` becomes a leading literal string child.**
- **A break is `TextRun.break` (leading breaks only).** A `<Break/>` in the middle of a run splits the run into two runs with identical props, and the second gets `break` + 1. A `<Break/>` directly in a Paragraph becomes `TextRun { break: 1 }`. docx.js's `Break` class is not exported.
- **Run content standing directly in a Paragraph is wrapped in a `TextRun`.** This covers strings, `Tab` and `PageNumber`.
- **`heading` becomes `style`.**
- **Presence-only booleans set to `false` are removed.**
- **At most one Header and one Footer per `type` per Section.** `type` defaults to `"default"`.
- **Every comment id referenced by a range or reference node resolves to a `<Comment>`.**

## Current State

Nothing in this effort is started. `specs/design/2026-11-03-document-tree-hub.md` exists. Everything else listed in *Background & Context* is the current code.

## Out of Scope

- **Phase 2: `.docx` reader, JSX source printer, HTML preview, subpath exports.** That covers `@react-docx/core/reader`, `readDocx`, `/codegen`, `printJsx`, `/html`, `DocxPreview`, `resolveDocument`, the `src/ooxml/` property codecs, the effective style sheet, the round-trip check, the in-memory XML-string fixture builder, and making `renderToTree` importable without docx.js. All of it is specified in `specs/2026-11-03-phase-2-reader-preview/`. Nothing in this phase builds any of it.
- **Writing RawXml that needs relationships or new package parts** (raw drawings, cropped images, charts, SmartArt, OLE, raw `r:id` hyperlinks). There is no verified mechanism, so it is a later effort.
- **The roughly 20 `Math*` building blocks** (`MathFraction`, `MathRadical`, `MathSum`, …) as components. Their named slots need their own small design. They go in `NOT_MAPPED` with that reason.
- **Endnotes.** docx.js cannot write them.
- **`patchDocument`** (docx.js's API for filling `{{placeholders}}` in an existing `.docx`). It is not a tree element and needs a separate API decision.
- **Version bump, changelog, npm publish.** These are the user's release decisions (decision 12).
- **Any change to folio.**
- **Suspense or async components inside documents.** Rendering is one synchronous pass.
- **README rewrite.** Update only the lines a unit makes false. A full documentation pass is separate.
- **The engines field and tsup `target: "node16"`.** Leave them as they are.

## Acceptance Criteria

- **AC1.** `pnpm run type-check` exits 0. Source types are sound after every unit.
- **AC2.** `pnpm run build` exits 0, and `dist/index.js`, `dist/index.mjs` and `dist/index.d.ts` exist.
- **AC3.** `test/cleanup.test.ts` passes. It asserts that `plugins/`, `pnpm-workspace.yaml`, `src/transformers/html-transformer.ts` and `src/transformers/dom-transformer.ts` do not exist, that `package.json` has no `@babel/*`, `mammoth` or `@react-docx/core` devDependency, and that `.gitignore` contains `examples/*.docx`.
- **AC4.** `pnpm test` runs vitest and exits 0, with `test/characterization.test.tsx` present and passing.
- **AC5.** `pnpm run test:react` exits 0 after printing an `ok` line for both the ESM and the CommonJS build under each of React 18.3.1, 19.0.0, 19.1.0, 19.2.0 and 19.3.1, ten lines in all. Each version is listed next to the reconciler line expected for it (29, 31, 31, 33, 33).
- **AC6.** `test/react-line.test.ts` passes. The mapping from React version to reconciler line, and the unsupported-version error, are covered.
- **AC7.** `test/canonical.test.ts` passes. Every invariant in decision 5, the style folding (decision 7), List expansion (decision 11), `TreeError` paths, and idempotence (`canonicalize(canonicalize(x))` equals `canonicalize(x)`) are covered.
- **AC8.** `test/presence-booleans.test.ts` passes. The `PRESENCE_ONLY` table equals docx.js's actual behavior for every boolean option of the paragraph, run, table, row and cell option types.
- **AC9.** `test/characterization.test.tsx` passes after the writer cutover. Only the snapshots of the cases named as bugs changed, and `test/writer-fixes.test.tsx` passes, asserting the corrected XML for each row of the Background bug table.
- **AC10.** `test/tree-input.test.tsx` passes. For every characterization case, `renderToBuffer(renderToTree(el))` and `renderToBuffer(el)` give identical normalized XML, and `renderToBase64` decodes to the same bytes as `renderToBuffer`.
- **AC11.** `pnpm run examples` (a script unit 04 adds) exits 0 after running all four `examples/*.tsx`.
- **AC12.** `test/raw-xml.test.tsx` passes. RawXml in block, inline and run positions is written verbatim, a fragment holding `r:id` throws, and a fragment whose root element doesn't fit its slot throws `TreeError`.
- **AC13.** `test/notes-and-blocks.test.tsx` passes. Footnotes are numbered in body order, comments and their ranges resolve, and `TableOfContents` and `Textbox` are written.
- **AC14.** `test/inline-elements.test.tsx` passes. Each inline and run-content kind from requirement 11 that units 05 and 06 do not cover is written with the expected OOXML element.
- **AC15.** `test/coverage.test.ts` passes. Every docx.js export that is a content class is either a kind in `ELEMENTS` (by its `docx` field) or a key of `NOT_MAPPED` with a non-empty reason.

## Units

| # | File | What it changes |
|---|---|---|
| 01 | `01-cleanup-and-harness.md` | Delete the extension and dead code, add vitest, pin current writer output in characterization snapshots |
| 02 | `02-react-lines.md` | Three aliased reconcilers picked by `React.version`; the React 18/19 matrix against `dist/` |
| 03 | `03-canonical-tree.md` | `src/schema/elements.ts`, `src/tree/canonical.ts`, the presence-only probe. Pure, not yet wired |
| 04 | `04-writer-on-tree.md` | Reconciler builds author nodes → `canonicalize` → new writer; delete the classes, transformer and 17 component files; bug fixes land |
| 05 | `05-raw-xml.md` | The `RawXml` kind and its writer, with the relationship and slot guards |
| 06 | `06-notes-and-blocks.md` | `Footnote`, `Comment` with ranges, `TableOfContents`, `Textbox` |
| 07 | `07-inline-coverage.md` | The remaining inline and run kinds, plus the docx.js coverage test |

Run them in order. Each leaves the repo green on its own.

## Verification

```sh
pnpm install
pnpm run type-check
pnpm test
pnpm run build
pnpm run test:react
pnpm run examples
```

## Open Questions

None for this phase. The design's three open questions were answered by the user on 2026-11-03 and are recorded in phase 2's Decisions Made:

- properties docx.js cannot express are dropped and reported;
- list numbers in headers and footers become literal text;
- folio's adoption of the reader is out of scope.

The user also confirmed two things for this phase: the work is split into two phases, and the version bump and publish stay out of the units.

## Landed


01. ✔ 16 files. Deleted plugins/, pnpm-workspace.yaml and the html/dom transformers; `pnpm test` now runs vitest: 2 files, 24 tests (17 characterization snapshots with 6 labelled [bug], the stability test, 6 cleanup checks); type-check and build pass. Hyperlink rId normalization widened to `rId[a-z0-9_-]{20,}` because docx.js nanoid ids contain `_`.
02. ✔ 15 files. Reconcilers 0.29/0.31/0.33 picked from React.version; `pnpm test` 3 files, 36 tests (12-row react-line table); `pnpm run test:react` printed ok for 18.3.1, 19.0.0, 19.1.0, 19.2.0, 19.3.1 in esm and cjs. Carried should-fix: on React 19 an error caught by a user error boundary still rejects the render (spec passes the recorder as onCaughtError; React 18 renders the fallback); `throw undefined` is swallowed on React 19.
03. ✔ 7 files. `pnpm test` 5 files, 134 tests (82 canonical rules, each checked pure and idempotent; a 20,000-document fuzz in review found no second-pass change); type-check clean; no runtime docx import in src/schema or src/tree. Presence-booleans probe printed `{}`: docx 9.5.1 writes `w:val="false"` for every boolean, `tableHeader` included, so `PRESENCE_ONLY = {}` and rule 8 is inert. **Canonical form changed by fix round 1 (rules 2 and 4):** a canonical TextRun's children never contain `""` or a `PAGE_NUMBER_VALUES` string; such a literal lives in `props.text` of a TextRun of its own (no children, same props; `break` only on the first of a split). Consequences — unit 04: the TextRun builder is one `new docx.TextRun({...props, children})`, the sentinel-escape splitting steps are dead, and `Props<"TextRun">` in src/schema/elements.ts:69 must be widened to allow `text` (today it omits it; a cast hides this). Phase 2: reader needs no change (literal `w:t` "CURRENT" canonicalizes to `text`); codegen prints it as an ordinary `text` prop and its "split excluded from identity test" note is void; html-resolve must read `props.text` before string children. `spec<P>` helper is curried (`spec<P>()({...})`). Carried should-fix: a nested `<List>`'s own `type` is ignored — it takes the outer list's reference (bullet-in-numbered renders numbered).
04. ✔ 36 files. `pnpm test` 7 files, 162 tests (8 writer-fix tests, 20 tree-vs-JSX tests); only the 6 `[bug]` snapshots changed, the 11 others byte-identical; `pnpm run examples` wrote all four files (header-footer.docx 10293 bytes); `test:react` 10 ok lines; `git diff --stat -- src/` 30 files, +267 −953. TextRun builder is one `docx.TextRun` and passes `children` only when non-empty (docx.js drops `text` when `children` is present, even `[]`); `Props<"TextRun">` widened to allow `text`. Outside the file list, authorized: `test/support/cases.tsx` bug-lists nests `<List>` instead of `level={1}` (each list now gets its own numId; nested item at ilvl 1); `examples/advanced.tsx` wraps a section-level `<PageBreak/>` in a Paragraph. Carried should-fix: README.md:201 still shows a bare `<PageBreak />` in a Section, which now throws, and "PageBreak/Tab/Bookmark must sit in a Paragraph" is not in the 0.2.0 breaking-changes list; `test/canonical.test.ts` "level 0 equals today's DEFAULT_NUMBERING" now compares LIST_NUMBERING with itself.
