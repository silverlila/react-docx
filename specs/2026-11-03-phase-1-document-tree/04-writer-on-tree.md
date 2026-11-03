# 04 — The writer builds from the canonical tree

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC1, AC2, AC9, AC10, AC11
- **You will see**:
  - `renderToTree(<Document>…</Document>)` returns a plain object you can `console.log` or `JSON.stringify`.
  - `renderToBuffer` accepts that object too.
  - In the snapshot diff, only the `[bug]` cases changed: no run inside a run, `Math` has its text, `SymbolRun` keeps `bold`, two numbered lists get two `w:numId`s, one `pStyle`, one `Heading1` definition.
  - `pnpm run examples` writes all four example files.

## Goal

Switch the pipeline to: reconciler → author nodes → `canonicalize` → a typed writer record → docx.js. Then delete the 21 node classes, the transformer and the 17 component files.

After this unit, adding a kind means one row in `src/schema/elements.ts`, one builder in `src/write/build.ts` (the compiler enforces it) and one export line in `src/components.ts`.

## Files

- `src/tree/host-config.ts`: `createInstance` builds plain host nodes. `createMutableNode` and its switch are deleted.
- `src/tree/render.ts`: adds `renderToTree`. `renderToHost` returns host nodes.
- `src/write/build.ts`: new. The `BUILD` record and `buildDocument`.
- `src/write/index.ts`: new. `renderToBuffer`, `renderToBlob`, `renderToBase64`.
- `src/components.ts`: new. One `element(kind)` line per component.
- `src/types.ts`: rewritten as authoring prop types, keeping every existing exported name.
- `src/constants.ts`: `DEFAULT_NUMBERING` becomes `LIST_NUMBERING`.
- `src/index.ts`: new export list.
- `package.json`: `docx` peer range; `examples` script.
- Delete: `src/nodes.ts`, `src/renderer.ts`, `src/transformers/docx-transformer.ts` (and the now-empty `src/transformers/`), and `src/components/` (17 `.tsx` files plus `index.ts`).
- `test/__snapshots__/characterization.test.tsx.snap`: re-recorded. Only the `[bug]` entries change.
- `test/writer-fixes.test.tsx`: new (AC9).
- `test/tree-input.test.tsx`: new (AC10).

## Changes

### 1. Host nodes (`src/tree/host-config.ts`, `src/tree/render.ts`)

```ts
/** What the reconciler builds. Mutable, internal, never exported. */
type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | HostText)[] };
type HostText = { type: "#text"; text: string };
```

- `createInstance(type, props)`: if `type` does not start with `"RD"`, throw `new TreeError([type], "Unknown element <type>")`. Otherwise return `{ type: type.slice(2), props: <props without children>, children: [] }`.
- `createTextInstance(text)`: return `{ type: "#text", text }`.
- `commitTextUpdate`: set `.text`.
- `commitUpdate`, in both variants: replace `props` without `children`.
- The container keeps `rootInstance: HostNode | null`. `appendChildToContainer` sets it for any child; canonicalize checks that it is a Document.

```ts
/** JSX → canonical tree. Synchronous. Throws the render error, or TreeError. */
export function renderToTree(element: React.ReactElement): DocumentNode;
```

The flow is `renderToHost(element)` → `toAuthor(host)` → `canonicalize`.
- `toAuthor` converts `HostText` to strings and copies children arrays.
- If no root rendered (for example the element returned `null`), throw `new TreeError([], "Nothing rendered; the root must be <Document>")`.

### 2. `src/write/build.ts`: one builder per kind

```ts
type Built = {
  Document: docx.Document; Section: docx.ISectionOptions; Header: docx.Header; Footer: docx.Footer;
  Paragraph: docx.Paragraph; TextRun: readonly docx.TextRun[]; Table: docx.Table; TableRow: docx.TableRow; TableCell: docx.TableCell;
  Tab: docx.Tab; PageNumber: string; ImageRun: docx.ImageRun; SymbolRun: docx.SymbolRun;
  ExternalHyperlink: docx.ExternalHyperlink; InternalHyperlink: docx.InternalHyperlink; Bookmark: docx.Bookmark;
  PageBreak: docx.PageBreak; Math: docx.Math; MathRun: docx.MathRun;
};
const BUILD: { readonly [K in Kind]: (node: Node<K>) => Built[K] } = { … };
export function buildDocument(tree: DocumentNode): docx.Document;
```

There is one cast site: a `buildChild(node: Node)` dispatcher that does `(BUILD[node.type] as (n: Node) => unknown)(node)`, with a comment saying TypeScript cannot correlate `BUILD[node.type]` with `node`. Every other line is typed.

| Kind | builds |
|---|---|
| Document | `new docx.Document({ ...props, sections: children.map(buildSection) })` |
| Section | `{ ...props, headers, footers, children }`. Header and Footer children go into `headers[type]` and `footers[type]` as `new docx.Header({ children })`; the rest go into `children`. The `TextRun` arrays are flattened |
| Paragraph | `new docx.Paragraph({ ...props, children })`, with TextRun arrays flattened |
| TextRun | **Sentinel escape.** The only builder returning an array, see below |
| Tab | `new docx.Tab()` |
| PageNumber | `node.props.field` (the docx.js sentinel string) |
| SymbolRun | `new docx.SymbolRun(props)`, passing the **full options object**. This fixes the SymbolRun bug |
| Math | `new docx.Math({ children: children.map(MathRun) })` |
| MathRun | `new docx.MathRun(children.join(""))` |
| ImageRun | `new docx.ImageRun(props)` |
| PageBreak | `new docx.PageBreak()` |
| Bookmark | `new docx.Bookmark({ id, children })` |
| ExternalHyperlink | `new docx.ExternalHyperlink({ link, children })` |
| InternalHyperlink | `new docx.InternalHyperlink({ anchor, children })` |
| Table | `new docx.Table({ ...props, rows: children.map(...) })` |
| TableRow | `new docx.TableRow({ ...props, children })` |
| TableCell | `new docx.TableCell({ ...props, children })` |

**TextRun and the sentinel escape.** docx.js turns a run child string equal to `"CURRENT"`, `"TOTAL_PAGES"`, `"TOTAL_PAGES_IN_SECTION"` or `"SECTION"` into a field. Canonical strings are always literal, so:

1. Walk the children.
2. Every literal string that equals a `PAGE_NUMBER_VALUES` member ends the current segment and becomes its own run, `new docx.TextRun({ ...propsWithoutBreak, text: s })`, because `text` is never sniffed.
3. Each other segment becomes `new docx.TextRun({ ...props, children: segmentChildren })`.
4. Only the first emitted run keeps `props.break`.
5. A TextRun with no children becomes `[new docx.TextRun(props)]`.

The common case, with no sentinel-equal literal, emits exactly one run.

**Verified equivalence.** `new docx.TextRun({ children: ["a"] })` writes the same `<w:r><w:t xml:space="preserve">a</w:t></w:r>` as today's `new docx.TextRun({ text: "a" })`. Both go through docx's `Text`. The characterization snapshots confirm this.

### 3. `src/write/index.ts`

```ts
export type RenderSource = React.ReactElement | DocumentNode;
export function renderToBuffer(source: RenderSource): Promise<Buffer>;
export function renderToBlob(source: RenderSource): Promise<Blob>;
export function renderToBase64(source: RenderSource): Promise<string>;   // docx.Packer.toBase64String, not Buffer
```

`const tree = isValidElement(source) ? renderToTree(source) : canonicalize(source as AuthorNode)`. Canonicalizing tree input costs little and is idempotent. It also means a hand-built tree with sugar or misplacements is normalized or rejected the same way JSX is.

Drop today's unexported `render` alias and `renderToDocx`.

### 4. `src/components.ts`

```ts
function element<P>(kind: string): React.FC<P> {
  const C: React.FC<P> = ({ children, ...props }: any) => React.createElement(`RD${kind}`, props, children);
  C.displayName = kind;
  return C;
}
export const Document = element<DocumentProps>("Document");
export const Section = element<SectionProps>("Section");
// … Header, Footer, Paragraph, TextRun, Table, TableRow, TableCell, Tab, ImageRun, ExternalHyperlink,
//   InternalHyperlink, PageBreak, Bookmark, SymbolRun, Math, MathRun (new), Break, List, ListItem
```

Each export is a module-level constant created once. folio's `ofType(tree, Table)` compares `el.type === Table`, so identities must never be recreated.

### 5. `src/types.ts`: authoring props

docx.js option types are used verbatim, without `NotReadonly<>`. Keep every currently exported type name.

```ts
type Kids = { children?: ReactNode };
export type DocumentProps = Omit<docx.IPropertiesOptions, "sections" | "footnotes" | "comments" | "externalStyles"> & Kids;
export type SectionProps = Omit<docx.ISectionOptions, "children" | "headers" | "footers"> & Kids;
export type HeaderProps = { type?: "default" | "first" | "even" } & Kids;   // FooterProps the same
export type ParagraphProps = Omit<docx.IParagraphOptions, "children"> & Kids;
export type TextRunProps = Omit<docx.IRunOptions, "children"> & Kids;
export type TableProps = Omit<docx.ITableOptions, "rows"> & Kids;            // TableRowProps, TableCellProps likewise
export type ImageRunProps = docx.IImageOptions & { children?: never };
export type SymbolRunProps = docx.ISymbolRunOptions & { children?: never };
export type MathProps = { text?: string } & Kids;
export type MathRunProps = Kids;
export type ListProps = { type?: "bullet" | "numbered" } & Kids;             // level removed (decision 11)
export type ListItemProps = Omit<docx.IParagraphOptions, "children" | "numbering"> & Kids;
// TabProps, PageBreakProps, BreakProps, BookmarkProps, ExternalHyperlinkProps, InternalHyperlinkProps: as today
```

Delete `MutableTreeNode`, `ElementType`, `DocxInstance`, `DocxContainer`, `RenderFunction` and `NotReadonly`.

A `DocumentProps.styles` typed as docx.js's `IStylesOptions` without `NotReadonly` is what lets folio drop its `as any`. folio keeps compiling either way.

### 6. `src/constants.ts` and `src/index.ts`

- `src/constants.ts` becomes `export { LIST_NUMBERING as DEFAULT_NUMBERING } from "./tree/lists"`.
- `src/index.ts` exports:
  - every component from `src/components.ts`;
  - `renderToBuffer`, `renderToBlob`, `renderToBase64`, `renderToTree`, `TreeError`;
  - the types `DocumentNode`, `Node`, `Kind`, `Props`, `RenderSource` and every prop type from `src/types.ts`;
  - `ELEMENTS`, as a value;
  - `DEFAULT_NUMBERING`.
- It does **not** export `canonicalize`, `AuthorNode` or `buildDocument`.

### 7. `package.json`

- Change the peer to `"docx": "^9.5.0"` (decision 12).
- Add `"examples": "for f in basic header-footer resume advanced; do tsx examples/$f.tsx || exit 1; done"`. `tsx` is already a devDependency.

The examples import from `../src/index`. They use `List`/`ListItem` with `text` and `DEFAULT_NUMBERING`, which still work. They use no `level` prop and no `Section.headers` (checked on 2026-11-03 with `grep -nE "level=|headers=|footers=|footnotes" examples/*.tsx`).

### 8. Re-record the snapshots

Run `pnpm test -- -u`. Then check `git diff test/__snapshots__/characterization.test.tsx.snap`: every changed hunk must sit inside an entry whose key starts with `[bug] `.

If any other case changed, the cutover changed behavior. Fix the builder; do not re-record. That includes `default-styles-and-heading` (heading becomes style), `page-number-children` (sentinel strings), `run-text-children` (`text` becomes a child) and `tab-break-pagebreak` (Break and Tab wrapping).

### 9. `test/writer-fixes.test.tsx` (AC9)

One test per row of the bug table in `00-context.md`, asserting on `docxXml(...)["word/document.xml"]` or `["word/styles.xml"]`:

- **Tab in a run:** `<TextRun>a<Tab />b</TextRun>` produces a `<w:r>` with no nested `<w:r>`. Assert `!/<w:r>(?:(?!<\/w:r>).)*<w:r>/.test(paragraphXml)`, and that `<w:tab/>` is present.
- **Math:** `<Math text="x+1" />` contains `<m:r>` and `x+1`.
- **SymbolRun:** `<SymbolRun char="F071" symbolfont="Symbol" bold />` contains `w:font="Symbol"` and a `<w:b/>` in its run properties.
- **Lists:**
  - two separate `<List type="numbered">` produce two distinct `w:numId` values;
  - `<List type="numbered"><ListItem>a</ListItem><List type="numbered"><ListItem>b</ListItem></List></List>` puts `b` at `w:ilvl="1"`;
  - `word/numbering.xml` defines `w:ilvl="1"` for the `NumberedList` abstract numbering.
- **Heading and style:** `heading` plus an equal `style` produces exactly one `<w:pStyle`.
- **Duplicate style id:** a Heading1 `paragraphStyles` entry gives exactly one `w:styleId="Heading1"` in `word/styles.xml`, and that definition contains `FF0000`.

### 10. `test/tree-input.test.tsx` (AC10)

For every entry in `CASES` (from `test/support/cases.tsx`), assert that `docxXml(await renderToBuffer(renderToTree(element)))` equals `docxXml(await renderToBuffer(element))`. Also, for one case, assert that `Buffer.from(await renderToBase64(element), "base64")` gives the same `docxXml` as the buffer. Add one test where `JSON.parse(JSON.stringify(tree))` of an image-free case renders identically. That proves the tree is plain data.

## Verify

```sh
pnpm test
pnpm run type-check
pnpm run build
pnpm run examples
pnpm run test:react
git diff --stat -- src/  # nodes.ts, renderer.ts, transformers/, components/ deleted
```

## Watch out

- These docx.js behaviors were verified on 2026-11-03 against docx 9.5.1, and the builders depend on them:
  - `new Paragraph({ text: "T", children: [run] })` writes the `T` run first, then the children. That is why canonical rule 4 prepends the text instead of dropping it.
  - `new TextRun({ text: "T", children: ["c"] })` writes only `c`. canonicalize avoids this by moving `text` into the children.
  - `new TextRun({ children: [new Tab()] })` writes `<w:r><w:tab/></w:r>`, the same as today's `{ text: "", children: [Tab] }`.
  - `new SymbolRun({ char, symbolfont, bold: true })` writes `<w:b/><w:bCs/>` and `w:font`.
  - `new Math({ children: [new MathRun("x+1")] })` writes `<m:r><m:t>x+1</m:t></m:r>`.

  If `run-text-children` or `list-item-outside-list` changes in the snapshot diff, look at these first.
- `examples/basic.tsx` passes `DEFAULT_NUMBERING as any`. The new levels 1–8 make its `numbering.xml` longer. That is intended, and examples are not snapshotted.
- `test/react-lines/render.*` import `dist/`, so run `pnpm run test:react` after the build. The host-config change must not regress any React line.
- Unit 02 put `HostTransitionContext` and the priority functions in `hostConfig19`. Keep them when you change `createInstance`.
