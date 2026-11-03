# react-docx as a hub: one document tree, four directions

> Design settled on 2026-11-03 by /architect. The shape below is the input to /to-spec.

## Problem

react-docx (`@react-docx/core` 0.1.8) is a React custom renderer over docx.js 9.5. It turns JSX into a `.docx` file and does nothing else. Three new directions are wanted:

- read a `.docx` back,
- print what was read as JSX source,
- preview either a read file or authored JSX as HTML.

The current internals cannot carry these:

- **Each element is described five times.** `src/nodes.ts` has a class per element, `src/types.ts` has the union, `src/reconciler-v19.ts` has the switch, `src/transformers/docx-transformer.ts` has the if-chain, and `src/components/*.tsx` has the component.
- **Normalization is mixed into docx.js construction.** Examples: `transformTab` wraps a Tab in a run, so `<TextRun><Tab/></TextRun>` emits a run inside a run. `transformSection` merges `props.headers` with Header children. `ensureNumberingConfig` sits in render orchestration. Because of this, there is no tree a reader could target or a round-trip test could compare.
- **Props are `any`.**
- **React 19 does not work.** `react-reconciler` is pinned to 0.29.0, which runs only on React 18, while the peer dependency claims `>=16.8`.

**Constraints:**

- **docx.js's data model.**
  - Option shapes are `IParagraphOptions`, `IRunOptions`, `IStylesOptions`, `INumberingOptions`, and so on.
  - It has no reader.
  - `ImportedXmlComponent.fromXmlString` is broken. The working path is `convertToXmlComponent(xml2js(...))`, and `xml-js` is a real dependency of docx.
  - Raw XML fragments do not carry relationships (`r:id`, `r:embed`).
  - docx.js writes no theme part.
  - Its `Break` class is not exported.
  - Numbering instances register only for body paragraphs.
  - A new numbering `instance` restarts the list.
  - When `numbering` is set without `style` or `custom`, docx.js adds `ListParagraph`.
  - Boolean options are written when present, so `tableHeader={false}` still emits `<w:tblHeader/>`.
  - Plain strings in run children that equal `PageNumber.*` values become fields.
- **folio cannot break.** folio is the sibling repo, on React 18.3. It uses `Document, Section, Header, Footer, Paragraph, TextRun, Tab, Break, PageBreak, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, renderToBlob, renderToBuffer` and the `heading=` prop. It writes `<TextRun children={[PageNumber.CURRENT]} />` and relies on those strings becoming fields. It matches elements by component identity (`ofType(tree, Table)` is `el.type === Table`), so every exported component must remain a single stable module constant. folio passes none of the props this design removes (`Section.headers/footers`, `Document.footnotes/comments/externalStyles`).
- **React reconcilers are tied to React lines at runtime.** 0.29 runs on React 18, 0.31 on 19.0 and 19.1, and 0.33 on 19.2 and later. 0.31 and later remove the legacy root, so rendering must use `updateContainerSync` followed by `flushSyncWork`. `createContainer` takes 10 arguments there, and `commitUpdate` loses `updatePayload`.

## Already decided

- **The plain node tree `{type, props, children}` is the hub.** Every direction reads or writes it, so authored JSX and read files share one renderer, one printer and one writer.
- **Props are docx.js option shapes verbatim, with no style-transformation layer.** Users can read the docx.js documentation directly. (CLAUDE.md, "Direct DOCX API Mapping".)
- **The reader is faithful, not lossy.** It keeps style references (`style="Heading1"`) and emits the styles.xml definitions into Document props, instead of computing formatting onto each run. Content docx.js cannot express goes into `<RawXml>`, and every fallback is reported in a diagnostics list. folio's reader is lossy by design because it reduces to theme tokens; this one must not be.
- **JSX codegen ships in the first reader release.** "Word file → editable component" is the feature that serves the original three-templates problem.
- **The HTML renderer owns its own style resolver.** The cascade is docDefaults, then the style `basedOn` chain, then the numbering level, then direct formatting. The renderer does no pagination: it draws one continuous page per section at the section's width and margins, and marks explicit page breaks. folio built a measurement paginator and removed it, because "every measurement-driven paginator we tried disagreed with both exports".
- **The reader and the HTML renderer ship as subpath exports and must be browser-safe.** People who only write documents must not have the parser bundled.
- **One package supports React 18 and React 19.** folio is on 18, and new apps are on 19.
- **One mapping table describes every element.** It replaces the five places, and a coverage test checks it against docx.js's exports.
- **The reader's parsing layer is adapted from folio's `packages/rebuild/docx-parts.ts`.** That covers fflate, htmlparser2 in xmlMode, rels, the `basedOn` chain, numbering, theme fonts and core props. folio's body walk (`docx-body.ts`) is not ported, because it is lossy by design.
- **The test oracle is a round trip.** Read, write, then read again must give the same tree the second time. Fixtures are built in memory from XML strings zipped with fflate, following folio's `packages/rebuild/test/docx-fixture.ts`. An optional soffice visual check is available.
- **Cleanup.** Delete `plugins/`, the `plugins/*` workspace entry, `src/transformers/html-transformer.ts`, `src/transformers/dom-transformer.ts`, the babel and mammoth devDeps, and the self-devDependency on `@react-docx/core`. Add the untracked `examples/*.docx` to `.gitignore`.

## Out of scope

- **The VS Code extension.** It is being deleted.
- **Word-accurate pagination in HTML.** It was tried in folio and removed.
- **Reducing formatting to theme tokens.** That is folio's job, downstream of the reader.
- **Changes to folio.** This design keeps folio compiling and rendering unchanged. Adopting the reader inside folio is a later decision.
- **mammoth and docx-preview.** folio tried both and dropped them (`folio/context/dead-ends.md`).
- **Writing RawXml that needs relationships or new package parts.** This covers raw drawings, cropped images, charts, SmartArt, OLE, and raw content carrying `r:id` hyperlinks. It needs a package-patching mechanism nobody has verified, so it is a follow-on effort. This release handles it with the reader policy in *Shape* below.
- **The ~20 `Math*` building blocks** (fractions, radicals, n-ary operators and so on) as authoring components. Their named slots (numerator/denominator, sub/sup) need their own small design for slot components. OMML carries no relationships, so the reader keeps such math losslessly as RawXml in the meantime. `Math` and `MathRun` are in scope.
- **Endnotes.** docx.js cannot write them. The reader reports them as dropped.
- **Suspense and async components inside documents.** Rendering is a single synchronous pass.

## Done looks like

- In a Node script, `readDocx(bytes)` on a real Word resume returns `{ document, diagnostics }`. `renderToBuffer(document)` writes a `.docx` that opens in Word without a repair prompt and looks like the original. `diagnostics` lists each element that went to RawXml, each property that was dropped, and each theme value that was resolved, with the part and tree path for each.
- `printJsx(document, { componentName: "Resume" })` returns `Resume.tsx` plus an `assets/` folder. Running `Resume.tsx` through `renderToBuffer` writes the same document.
- In a browser, `<DocxPreview document={tree} />` shows a dropped `.docx` file, and the same component shows authored JSX via `renderToTree(<Resume data={data} />)`. Neither path ships docx.js or the XML parser to the preview bundle.
- `renderToBuffer` works in a React 18.3 app (folio, unchanged) and in a React 19.x app.
- `pnpm test` runs, and it includes the round-trip check over the fixture set and the coverage check against docx.js's exports.

## Usage (caller's view)

```tsx
// Write. Unchanged for existing users, folio included.
import { Document, Section, Paragraph, TextRun, renderToBuffer } from "@react-docx/core";
import { AlignmentType, PageNumber } from "docx";

const bytes = await renderToBuffer(
  <Document>
    <Section>
      <Paragraph alignment={AlignmentType.CENTER}>
        <TextRun text="Ada Lovelace" bold size={32} />
      </Paragraph>
      <Paragraph><TextRun children={["Page ", PageNumber.CURRENT]} /></Paragraph>
    </Section>
  </Document>,
);
```

```ts
// Word file → tree → .docx again → editable component (Node script)
import { readDocx } from "@react-docx/core/reader";
import { printJsx } from "@react-docx/core/codegen";
import { renderToBuffer } from "@react-docx/core";

const { document, diagnostics } = readDocx(new Uint8Array(await fs.readFile("resume.docx")));
for (const d of diagnostics) if (d.kind !== "ignored") console.warn(d.kind, d.part, d.at, d.element);

await fs.writeFile("roundtrip.docx", await renderToBuffer(document));   // render functions accept a tree too

const { source, assets } = printJsx(document, { componentName: "Resume" });
await fs.writeFile("Resume.tsx", source);
for (const a of assets) await fs.writeFile(a.path, a.bytes);           // "assets/image1.png", relative to Resume.tsx
```

```tsx
// Browser preview: a dropped file, or authored JSX. No docx.js, no parser in this bundle.
import { DocxPreview, renderToTree } from "@react-docx/core/html";
import { readDocx } from "@react-docx/core/reader";

function FilePreview({ bytes }: { bytes: Uint8Array }) {
  const tree = useMemo(() => readDocx(bytes).document, [bytes]);
  return <DocxPreview document={tree} className="page" />;
}
function LivePreview({ data }: { data: ResumeData }) {
  const tree = useMemo(() => renderToTree(<Resume data={data} />), [data]);   // sync
  return <DocxPreview document={tree} />;
}
// Every rendered block carries data-docx-path="0.3.1", so a diagnostic's `at` maps to a DOM node.
```

```tsx
// What codegen prints for content docx.js cannot express; authors can write it too.
import { Paragraph, RawXml } from "@react-docx/core";
<Paragraph><RawXml xml={`<w:r><w:fldChar w:fldCharType="begin"/></w:r>…`} /></Paragraph>
```

## Shape

### The hub: canonical tree types (`src/schema/`), data only, type-only import of docx

```ts
// schema/elements.ts: THE table. Vocabulary, containment grammar, docx class, OOXML names.
type Spec<P> = {
  readonly docx: keyof typeof import("docx") | null; // class it builds; null = folded into a parent option (Section, Header, Footnote, PageNumber)
  readonly children: readonly ChildSlot[];            // containment grammar
  readonly text: boolean;                             // may hold literal string children (TextRun and its variants, MathRun)
  readonly ooxml: readonly string[];                  // OOXML names it is read from; used by the coverage test, not for dispatch
  readonly props?: P;                                 // phantom: carries the props type
};

export const ELEMENTS = {
  Document:  spec<DocumentProps>({ docx: "Document", children: ["Section", "Comment"], text: false, ooxml: ["w:document"] }),
  Section:   spec<Omit<docx.ISectionOptions, "children" | "headers" | "footers">>({ docx: null, children: ["Header", "Footer", ...BLOCK, ...SECTION_ONLY], ... }),
  Header:    spec<{ type: "default" | "first" | "even" }>({ docx: "Header", children: BLOCK, ... }),
  Paragraph: spec<Omit<docx.IParagraphOptions, "children" | "text" | "heading">>({ docx: "Paragraph", children: INLINE, ... }),
  TextRun:   spec<Omit<docx.IRunOptions, "children" | "text">>({ docx: "TextRun", children: RUN_CONTENT, text: true, ... }),
  Footnote:  spec<{}>({ docx: "FootnoteReferenceRun", children: ["Paragraph"], ... }),   // inline; the writer assigns ids
  PageNumber:spec<{ field: (typeof docx.PageNumber)[keyof typeof docx.PageNumber] }>({ docx: null, children: [], ... }),
  RawXml:    spec<{ xml: string }>({ docx: "ImportedXmlComponent", children: [], ... }),  // legal in block, inline and run slots
  // … one row per element (≈45). See the list under "Element set" below.
} as const satisfies Record<string, Spec<unknown>>;

export type Kind = keyof typeof ELEMENTS;
export type Props<K extends Kind> = NonNullable<(typeof ELEMENTS)[K]["props"]>;
/** The grammar is in the type: a run cannot hold a run, a Tab cannot stand in a Section. */
export type Node<K extends Kind = Kind> = K extends Kind
  ? { readonly type: K; readonly props: Props<K>; readonly children: readonly ChildOf<K>[] } : never;
type ChildOf<K extends Kind> = Node<(typeof ELEMENTS)[K]["children"][number]> | ((typeof ELEMENTS)[K]["text"] extends true ? string : never);
export type DocumentNode = Node<"Document">;

/** Elements docx.js exports that are deliberately not tree kinds, each with its reason. The coverage test reads this. */
export const NOT_MAPPED: Readonly<Partial<Record<keyof typeof import("docx"), string>>>;

// schema/styles.ts: "which style definitions the output contains", known in exactly one place
export type StylesProps = Omit<docx.IStylesOptions, "importedStyles" | "initialStyles">
  & { readonly importedStyles?: readonly string[] };   // raw <w:style> XML that IStylesOptions cannot express (table and numbering styles)
export type DocumentProps = Omit<docx.IPropertiesOptions, "sections" | "footnotes" | "comments" | "styles" | "externalStyles">
  & { readonly styles?: StylesProps };
export type EffectiveSheet = { readonly docDefaults: docx.IDocumentDefaultsOptions; readonly styles: ReadonlyMap<string, StyleDef> };
/** docx.js's built-in defaults (generated snapshot) merged the way docx.js merges them, overridden by id. */
export function effectiveSheet(styles: StylesProps | undefined): EffectiveSheet;
```

**Invariants of the canonical tree.** Every one of them is established by `canonicalize`, so no other module checks it.

- **Plain data only.** No class instances. Props are JSON values, plus `Uint8Array` for image data and `Date` for comment dates.
- **Strings in children are always literal text.** A page-number field is a `PageNumber` node. Two strings are never adjacent.
- **Breaks are `TextRun.break` (leading only).** A break in the middle of a run splits the run into two runs with identical props. This matches docx.js, whose `Break` class is not exported.
- **`heading` has become `style`.** docx.js emits a duplicate `w:pStyle` when both are set.
- **Presence-only booleans set to `false` are stripped.** Which options are presence-only is learned by a test that writes each one as `false`.
- **There is no `List` or `ListItem` in the tree.** Each list is a set of numbered `Paragraph`s. Each top-level `List` gets its own `instance`, nesting depth sets `level`, and configs for levels 0–8 are injected.
- **Each Section has at most one Header and one Footer per type.**
- **Footnotes are inline nodes.** A Footnote's content sits where it is referenced, so the tree has no footnote ids to dangle.
- **Comments live as `Comment` children of Document.** Their ranges are marked by `CommentRangeStart/End/Reference` ids, and every id resolves.
- **Every reader-assigned id is an ordinal of first appearance, never a source id.** This covers numbering references, instances and comment ids, and it is what makes read → write → read a fixed point.
- **`RawXml.xml` contains no `r:*` relationship attribute.** The reader guarantees this, and the writer throws on authored RawXml that has one.

### The gate (`src/tree/`): the only way into the hub, with no docx.js runtime import

```ts
/** Authoring side: docx.js shapes verbatim, aliases included (text, heading, break, List, ListItem, Break, sentinel strings). */
export type AuthorNode = { readonly type: Kind | "List" | "ListItem" | "Break"; readonly props: Record<string, unknown>; readonly children: readonly (AuthorNode | string)[] };
export class TreeError extends Error { constructor(readonly path: readonly string[], message: string); } // ["Document","Section[0]","Paragraph[3]"]
/** Pure and idempotent. Both JSX and the reader go through it. */
export function canonicalize(root: AuthorNode): DocumentNode;

/** JSX → tree. Sync. Picks the reconciler from React.version, renders, unmounts, canonicalizes. */
export function renderToTree(element: React.ReactElement): DocumentNode;
```

**React 18/19.** `tree/host-config.ts` is one generic host config with no per-kind switch: `createInstance` returns `{type, props − children, children: []}`. `tree/react-line.ts` maps `React.version` to one of three lines:

- **18** uses `react-reconciler-29` with a legacy root, and `updateContainer` is sync.
- **19.0–19.1** uses `react-reconciler-31`.
- **19.2+** uses `react-reconciler-33`.

The 19 lines use `createContainer` with 10 arguments, whose error callbacks capture the error for rethrow, followed by `updateContainerSync` and `flushSyncWork`. Any other version throws `react-docx supports React 18 and 19, found X`. All three reconcilers are installed under npm aliases and bundled; each is instantiated lazily the first time its line is selected. This is the approach @react-pdf/reconciler takes.

### The writer (`src/write/`), the only runtime importer of docx

```ts
export function renderToBuffer(source: React.ReactElement | DocumentNode): Promise<Buffer>;
export function renderToBlob(source: React.ReactElement | DocumentNode): Promise<Blob>;
export function renderToBase64(source: React.ReactElement | DocumentNode): Promise<string>;   // Packer.toBase64String, no Buffer
// isValidElement(source) ? build(renderToTree(source)) : build(source)

type BuildCtx = { readonly sheet: EffectiveSheet; readonly footnotes: FootnoteCollector };
/** Compiler-enforced exhaustive: adding a Kind without a builder fails to compile. */
const BUILD: { readonly [K in Kind]: (node: Node<K>, ctx: BuildCtx) => DocxOut[K] };
```

The writer does four things beyond building each node:

- **Footnotes.** It collects Footnote nodes in body order, gives them ids 1..n, and fills `Document.footnotes`.
- **Comments.** It collects `Comment` children into `Document.comments`.
- **Headers and footers.** It routes Header and Footer children into `headers` and `footers` by type.
- **Styles.** It always passes the complete `effectiveSheet` as explicit styles, so docx.js never adds a second definition of a style id the document defines.

`RawXml` becomes `convertToXmlComponent(xml2js(xml).elements[i])`. A literal string that happens to equal a `PageNumber` sentinel is written through `text` in its own run, so it stays text.

### The reader (`@react-docx/core/reader`), the only importer of fflate and htmlparser2

```ts
export type TreePath = readonly number[];
export type PartName = "document" | "styles" | "numbering" | "footnotes" | "comments" | `header${number}` | `footer${number}`;
export type Diagnostic =
  | { readonly kind: "raw";      readonly part: PartName; readonly at: TreePath; readonly element: string; readonly because: string }  // kept verbatim in RawXml
  | { readonly kind: "resolved"; readonly part: PartName; readonly at: TreePath; readonly element: string; readonly detail: string }   // theme font → "Calibri"
  | { readonly kind: "dropped";  readonly part: PartName; readonly at: TreePath | null; readonly element: string; readonly because: string } // not in the tree
  | { readonly kind: "ignored";  readonly element: string; readonly count: number };  // rsid*, proofErr, lastRenderedPageBreak, _GoBack
export type ReadResult = { readonly document: DocumentNode; readonly diagnostics: readonly Diagnostic[] };
export class NotADocxError extends Error {}
/** Pure, sync, browser-safe. Throws only on bytes that are not a Word package. */
export function readDocx(bytes: Uint8Array): ReadResult;
```

**What the reader does with each kind of content:**

- **Elements.** Each OOXML element maps to a tree kind, or else to `RawXml` with a `raw` diagnostic.
- **Properties.** Properties inside `rPr`, `pPr`, `tblPr`, `trPr`, `tcPr`, `sectPr` and `lvl` go through per-container fate tables in `src/ooxml/`. Each property is `mapped`, `resolved` (theme fonts and colours become literals, because docx.js writes no theme), `ignored` (layout caches and editing noise), or `dropped`. A property with no listed fate is `dropped` with a diagnostic. The containing element is not turned into RawXml.
- **Styles.** `styles.xml` becomes `StylesProps`. Table and numbering styles are kept as `importedStyles` XML strings.
- **Numbering.** `numbering.xml` becomes `numbering.config` with ordinal references. Each `numId` becomes an `instance`. `custom: true` is set whenever the source paragraph has no pStyle. Level features outside `ILevelsOptions`, and overrides on levels above 0, are `dropped`.
- **Content that needs relationships.**
  - Images become `ImageRun`. A crop or an effect is `dropped` with a diagnostic, and the image is kept uncropped.
  - A chart or SmartArt with an `mc:Fallback` picture becomes that picture, reported as `resolved`. Without a fallback it is `dropped`.
  - Hyperlinks become `ExternalHyperlink`.
  - Nothing that holds an `r:*` attribute ever reaches RawXml.
- **Pipeline.** `read/body.ts` emits `AuthorNode`s and passes them through the same `canonicalize`.
- **Raw XML text.** It is serialized by one deterministic serializer, so the second read reproduces the first.

### Codegen (`@react-docx/core/codegen`), no runtime dependencies

```ts
export type Asset = { readonly path: `assets/${string}`; readonly bytes: Uint8Array };
export type GeneratedModule = { readonly source: string; readonly assets: readonly Asset[] };
export function printJsx(document: DocumentNode, options?: { readonly componentName?: string }): GeneratedModule;
```

Printing is generic over `Node`: `<Type {...props}>children</Type>`, with props in a stable key order. The special cases are:

- strings become JSX text, or `{"…"}` when they have edge whitespace or JSX-significant characters;
- `PageNumber` becomes `{PageNumber.X}`, imported from `docx`;
- `RawXml` becomes a template literal, with backticks and `${` escaped;
- image bytes become `readFileSync(new URL("./assets/…", import.meta.url))`;
- `Date` becomes `new Date("iso")`;
- styles and numbering are hoisted to consts.

### HTML (`@react-docx/core/html`), with no docx.js or parser import

```ts
export { renderToTree } from "../tree/render";
export type DocxPreviewProps = { readonly document: DocumentNode } & Omit<React.ComponentPropsWithoutRef<"div">, "children">;
export const DocxPreview: React.ForwardRefExoticComponent<DocxPreviewProps & React.RefAttributes<HTMLDivElement>>;

/** Pure; plain data out, so it is testable without React. Exported for tests and advanced use. */
export function resolveDocument(document: DocumentNode): readonly ResolvedSection[];
// ResolvedSection = { widthTwips, margins, header, body: ResolvedBlock[], footer }
// ResolvedBlock   = paragraph { format: ComputedParagraph, marker: string | null, inlines } | table { … } | raw { element }
// ResolvedInline  = text { text, format: ComputedRun } | tab | lineBreak | pageBreak | field | image { dataUri, … } | link | raw
```

`resolveDocument` builds the cascade from `effectiveSheet`, the same module the writer uses. That is why authored `heading={HEADING_1}` previews with docx.js's built-in Heading1. List counters are keyed by `(reference, instance, level)` and computed in document order before any React render.

**Units:**

| From | To | Rule |
|---|---|---|
| half-points | pt | ÷ 2 |
| twips | pt | ÷ 20 |
| EMU | pt | ÷ 12700 |
| border eighths | pt | ÷ 8 |
| `lineRule=auto` | unitless CSS line-height | line ÷ 240 |

Raw table styles are the one kind of RawXml the resolver interprets, through the same `src/ooxml/table` codec the reader uses, so a "Table Grid" table shows its borders. Every other RawXml renders as an empty marker element carrying `data-docx-raw`. Only the default header and default footer are shown.

**Element set.** The current 20 elements remain, with `List`, `ListItem` and `Break` becoming authoring sugar. These are added:

- **Inline:** `Footnote`, `Comment` + `CommentRangeStart/End/Reference`, `TableOfContents`, `Textbox`, `ColumnBreak`, `SimpleField`, `SimpleMailMergeField`, `SequentialIdentifier`, `CheckBox`, `InsertedTextRun`, `DeletedTextRun`, `MathRun`
- **Run content:** `PositionalTab`, `CarriageReturn`, `SoftHyphen`, `NoBreakHyphen`, `DayShort/Long`, `MonthShort/Long`, `YearShort/Long`, `PageNumber`
- **Escape hatch:** `RawXml`

These existing bugs are fixed by the shape:

- `Math` children become `MathRun` instead of `TextRun`.
- `SymbolRun` passes its full options instead of only `char`.
- `List` restarts and nests correctly.
- `NotReadonly<>` is removed, so folio's `as any` casts are no longer needed and still compile.

**Interface depth.** The public surface is:

- the components (the breadth required by direct mapping);
- the three render functions, widened to accept a tree;
- `renderToTree`, `readDocx`, `printJsx`, `DocxPreview` and `resolveDocument`;
- the tree types plus a read-only `ELEMENTS`;
- one `Diagnostic` union.

Behind that surface sit the React line choice and three reconciler APIs, canonicalization, footnote and comment id assignment, style-sheet composition, presence-boolean stripping, OPC packaging, the property codecs, ordinal identity, the cascade, list counters, and units.

These are deliberately not exported: `AuthorNode`, `canonicalize`, `EffectiveSheet`, the codecs, and the docx.js `Document`. Exporting any of them would let a caller build a non-canonical tree, or a second style sheet that disagrees with the writer.

## Module map

- `src/schema/elements.ts`: the vocabulary, containment grammar, props types, docx class names, `NOT_MAPPED`. Data only.
- `src/schema/styles.ts` + `src/schema/docx-default-styles.generated.ts`: `effectiveSheet`. The writer and the resolver both read it.
- `src/tree/canonical.ts`: `canonicalize`, `TreeError`. Owns every canonical-form rule, including List expansion and the presence-only list.
- `src/tree/host-config.ts`, `src/tree/react-line.ts`, `src/tree/render.ts`: own which React line is loaded and how the sync render runs. They do not import docx.
- `src/components.ts`: one `element("Kind")` line per exported component, with stable identities. It replaces the 17 component files.
- `src/write/build.ts`, `src/write/styles.ts`, `src/write/index.ts`: own tree → docx.js and the three render functions.
- `src/ooxml/*.ts`: own the property vocabulary (rPr, pPr, tblPr, trPr, tcPr, sectPr, lvl) ↔ docx.js options, as fate tables over a parser-free `XmlElement`. Shared by the reader and the resolver.
- `src/read/package.ts`: zip, part lookup, rels, media. Adapted from folio's `docx-parts.ts`. The only place that imports fflate or htmlparser2.
- `src/read/body.ts`, `src/read/styles.ts`, `src/read/numbering.ts`, `src/read/theme.ts`, `src/read/ordinals.ts`, `src/read/index.ts`: own OOXML structure → `AuthorNode`s, diagnostics, `readDocx`.
- `src/codegen/print.ts`: `printJsx`.
- `src/html/resolve.ts`, `src/html/css.ts`, `src/html/preview.tsx`: the cascade and counters, units → CSS, and a thin DOM map.
- `test/fixtures.ts`: an in-memory `.docx` builder. Also a round-trip test, a coverage test, a presence-boolean probe, and a React-line matrix (18.3, 19.0, 19.1, 19.2).
- **Entries:** `src/index.ts` (root), `src/read/index.ts`, `src/codegen/index.ts`, `src/html/index.ts`. Set `"sideEffects": false`.
- **Peer ranges:** React becomes `^18 || ^19`, and docx becomes `^9.5`. Ship this as 0.2.0.
- **Deleted:** `src/nodes.ts`, most of `src/types.ts` (prop type names stay as aliases), `src/reconciler-v19.ts`, `src/transformers/`, `src/components/*.tsx`, `plugins/`.

## Synthesis decision

The three stances converged on most of the shape:

- a plain-data tree;
- one data-only element table with the containment grammar in it;
- per-direction, compiler-enforced exhaustive records instead of one object per element carrying every direction's functions (object fields cannot be tree-shaken, so that would break subpath isolation);
- render functions that accept a tree;
- docx-instance props (`Section.headers/footers`, `Document.footnotes/comments`) replaced by child nodes;
- parsed `IStylesOptions` instead of verbatim `externalStyles`;
- theme values resolved to literals;
- reconcilers bundled under aliases and selected by `React.version`;
- codegen that writes assets as separate files.

That convergence is the strongest evidence for the shape.

**Base: own-the-invariant.** Its single `canonicalize` gate, used by both JSX and the reader, means every canonical rule (breaks, sentinels, heading → style, lists, presence booleans) has one owner. It also gives the round-trip test something real to compare. Its shared `effectiveSheet` is the only candidate answer to a real failure: docx.js's built-in styles are invisible to an HTML resolver, and they would collide with read style definitions in the writer.

**Grafted from ideal-caller:**

- plain strings as literal text (instead of `Text` nodes), which keeps walks and codegen simpler;
- inline `Footnote` nodes with writer-assigned ids, which make dangling footnote ids unrepresentable and make authoring natural;
- a separate `/codegen` subpath;
- `data-docx-path` on rendered blocks;
- the invariant that RawXml never holds a relationship.

**Grafted from extend-whats-there:**

- the observation that `xml-js` is already a docx dependency, so RawXml can stay a readable string and the writer parses it at no added cost;
- default numbering extended to 9 levels while keeping today's references;
- `ListItem` outside a `List` still renders as a plain paragraph;
- `custom: true` on read numbering.

**Rejected:**

- **Parsed `XmlElement` + rels as the RawXml value (own-the-invariant).** It keeps the writer parser-free, but codegen would need an `xml` tagged template imported from the reader subpath, and its rel-registration half rests on a mechanism nobody verified. Writing raw content with rels is out of scope as a follow-on instead.
- **Escalating a whole run or paragraph to RawXml when one property is inexpressible (own-the-invariant).** Modern Word files put `w14:*` properties on many runs, so most of a real resume would stop being editable in codegen and HTML. Unknown properties are `dropped` and reported instead. *This bends the decision "anything docx.js cannot express goes into RawXml" at the property level. See Open questions.*
- **An async `renderToTree` that dynamically imports one reconciler (extend-whats-there).** It forces `use(promise)` into every live preview. @react-pdf shows that bundling all three reconcilers and calling the matching one works.
- **`DocxPreview` accepting JSX children directly (ideal-caller).** It renders a second reconciler inside a React DOM render, which is unverified under React 19. The caller writes `useMemo(() => renderToTree(el))` instead. The children form can be added later, without a breaking change, once verified.
- **A `Break` run-content node written via `rawXml("<w:br/>")` (ideal-caller, extend-whats-there).** It puts RawXml in the writer for a common element. Splitting runs at breaks uses docx.js natively and produces the same bytes Word reads.
- **Throwing when `TextRun` has both `text` and children (ideal-caller).** Canonicalization makes `text` the leading literal child, so text docx.js used to drop silently is kept and nothing throws.
- **Mirroring every `Math*` class now (own-the-invariant).** Named slots don't map onto JSX children without a slot-component design. Out of scope as a follow-on.
- **`parseTree` that only validates placement while the writer keeps normalizing (extend-whats-there).** That keeps two owners of the canonical form, which is the current fault.

## Tradeoffs accepted

- We accept that the canonical tree differs from the JSX that produced it (List becomes numbered Paragraphs, `heading` becomes `style`, `<Break/>` becomes `break`), in exchange for one shape per OOXML meaning. Every direction handles one case, and the round-trip check means something.
- We accept that a break in the middle of a run becomes two identical-prop runs, in exchange for no RawXml in the writer and no misordered breaks.
- We accept that inexpressible properties are dropped and reported, in exchange for trees that stay editable as JSX.
- We accept that theme fonts and colours become literals, in exchange for output that renders the same without a theme part (docx.js writes none).
- We accept that cropped images become uncropped and chart fallbacks become pictures (each reported), in exchange for never writing a dangling relationship. Raw content with relationships is a follow-on.
- We accept a generated snapshot of docx.js's default styles, which must be regenerated on docx.js upgrades (a test detects drift), in exchange for the writer and the preview agreeing on what `Heading1` means.
- We accept three bundled reconciler versions (roughly 3× the reconciler bytes in a browser bundle that renders JSX), in exchange for one package and a sync `renderToTree`.
- We accept breaking changes for non-folio users in a 0.2.0 release, in exchange for one source of truth per fact:
  - `Section.headers/footers`, `Document.footnotes/comments/externalStyles`, `List.level` and `<Math text>` are removed;
  - `importedStyles` becomes strings;
  - React 16/17 and docx 8 are dropped.
- We accept that `canonicalize` throws `TreeError` on placements docx.js used to swallow silently, in exchange for errors that name the path. This could surface a latent misplacement in folio.
- We accept that generated TSX is a Node module (`readFileSync` for assets), in exchange for readable source instead of inline base64.
- We accept that the HTML preview shows only the default header and footer, renders fields as placeholders or cached values, and marks RawXml as empty elements. That is preview fidelity, not print fidelity.

## Alternatives considered

- **Per-element objects holding writer, reader and HTML functions.** This is the literal "one table" and is the shallowest to learn, but it cannot be split across subpaths: writer users would bundle the parser and the preview would bundle docx.js. It lost on the browser-safety constraint.
- **The reader emits `externalStyles` (styles.xml verbatim).** It gives perfect style fidelity, but the HTML resolver would need a second, XML-shaped style model and codegen would print an opaque blob. It lost on interface depth: two style representations behind every consumer.
- **Separate package majors per React line** (the r3f, ink and konva approach). Each major is simpler, but it needs two publish tracks for one host config and fails the one-package decision.
- **Skipping the reconciler and walking elements by hand.** Hooks throw without React's internal dispatcher, and installing one couples to React internals per version, which is how react-ssr-prepass broke.

## Open questions

1. **Are inexpressible properties dropped or kept?** The design drops them with a diagnostic and keeps the element editable, which bends "anything docx.js cannot express goes into RawXml" at the property level. The alternative escalates the enclosing run or paragraph to RawXml, which is faithful but non-editable. A middle path, splicing raw property elements into docx.js's `rPr`/`pPr`, needs docx internals. Which do you want for v1?
2. **What happens to numbered paragraphs in headers and footers?** docx.js cannot register their numbering. The proposal is that the reader writes the marker as literal text, reported as `resolved`. Is that acceptable, or should the writer throw on authored ones?
3. **When should folio adopt the reader?** It's out of scope here, but if folio's upload path should eventually read through `@react-docx/core/reader` and keep only its token reduction, the `ooxml/` codecs are the seam it would use.

**Risks the first units must retire, not assume:**

- **Importing all three reconcilers under one React version.** Each reconciler build is expected to touch React internals only when its factory is called (the @react-pdf precedent). Prove it with the React-line test matrix before anything else depends on it.
- **The cost of the recursive `Node<K>` type.** Type-checking it over about 45 kinds is unmeasured. Spike it. The fallback is a hand-written children union per slot, checked against `ELEMENTS` by a test.
- **RawXml round-trip stability.** It depends on docx.js's serializer and htmlparser2 agreeing on escaping, self-closing tags and `xml:space`. It is the most likely way for the fixed-point check to fail, so the fixture set needs raw cases early.
- **Whether Word continues counting across two `w:num`s that share an abstractNum without overrides.** If it does, the reader must collapse them into one instance.

## First implementation step

Delete the extension and dead transformers. Then stand up vitest with the in-memory fixture builder, and add the React-line matrix test that renders one `<Document>` under React 18.3, 19.0, 19.1 and 19.2 through bundled aliased reconcilers.
