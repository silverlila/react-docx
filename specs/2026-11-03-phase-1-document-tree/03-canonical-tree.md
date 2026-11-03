# 03 — The element table and `canonicalize`

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC7, AC8
- **You will see**: `test/canonical.test.ts` reads as a list of rules. For example: "`<TextRun>a<Break/>b</TextRun>` becomes two runs", "two `<List>`s get instances 0 and 1", "a `Heading1` paragraph style moves into `styles.default.heading1`". `test/presence-booleans.test.ts` prints which docx.js boolean options are written even when `false`.

## Goal

Add the element table, the canonical tree types and the pure `canonicalize` function, each with full tests. Nothing calls them yet. Unit 04 wires them into the reconciler and the writer.

This unit covers the kinds that exist today plus `MathRun` and `PageNumber`. Units 05–07 add rows for the remaining kinds.

## Files

- `src/schema/elements.ts`: new. The element table, the `Kind`/`Props`/`Node` types, and the tree's prop types.
- `src/schema/docx-facts.ts`: new. `PRESENCE_ONLY`, `DEFAULT_STYLE_SLOTS`, `PAGE_NUMBER_VALUES`.
- `src/tree/canonical.ts`: new. `AuthorNode`, `TreeError`, `canonicalize`.
- `src/tree/lists.ts`: new. List expansion and `LIST_NUMBERING` (9 levels).
- `test/support/nodes.ts`: new. An `n(type, props, ...children)` helper that builds `AuthorNode`s.
- `test/canonical.test.ts`: new (AC7).
- `test/presence-booleans.test.ts`: new (AC8).

## Changes

### 1. `src/schema/elements.ts`

Data plus types. The only import is `import type * as docx from "docx"`; there are no runtime imports.

```ts
type Spec<P> = {
  readonly docx: string | null;        // docx.js export this kind constructs; null = folded into a parent option
  readonly children: readonly string[]; // legal child kinds (canonical form)
  readonly text: boolean;              // may hold literal string children
  readonly ooxml: readonly string[];   // OOXML element names it corresponds to (used by phase 2 and the coverage test)
  readonly props?: P;                  // phantom: never set at runtime, carries the props type
};
const spec = <P>(s: Omit<Spec<P>, "props">): Spec<P> => s;

const BLOCK = ["Paragraph", "Table"] as const;
const INLINE = ["TextRun", "ImageRun", "SymbolRun", "ExternalHyperlink", "InternalHyperlink", "Bookmark", "PageBreak", "Math"] as const;
const RUN_CONTENT = ["Tab", "PageNumber"] as const;
```

| Kind | docx | children | text | ooxml | props type |
|---|---|---|---|---|---|
| Document | `"Document"` | `["Section"]` | no | `w:document` | `DocumentProps` |
| Section | `null` | `["Header", "Footer", ...BLOCK]` | no | `w:sectPr` | `Omit<docx.ISectionOptions, "children" \| "headers" \| "footers">` |
| Header | `"Header"` | `BLOCK` | no | `w:hdr` | `{ readonly type: "default" \| "first" \| "even" }` |
| Footer | `"Footer"` | `BLOCK` | no | `w:ftr` | same as Header |
| Paragraph | `"Paragraph"` | `INLINE` | no | `w:p` | `Omit<docx.IParagraphOptions, "children" \| "text" \| "heading">` |
| TextRun | `"TextRun"` | `RUN_CONTENT` | **yes** | `w:r` | `Omit<docx.IRunOptions, "children" \| "text">` |
| Table | `"Table"` | `["TableRow"]` | no | `w:tbl` | `Omit<docx.ITableOptions, "rows">` |
| TableRow | `"TableRow"` | `["TableCell"]` | no | `w:tr` | `Omit<docx.ITableRowOptions, "children">` |
| TableCell | `"TableCell"` | `BLOCK` | no | `w:tc` | `Omit<docx.ITableCellOptions, "children">` |
| Tab | `"Tab"` | `[]` | no | `w:tab` | `{}` |
| PageNumber | `null` | `[]` | no | `w:fldSimple`, `w:instrText` | `{ readonly field: (typeof docx.PageNumber)[keyof typeof docx.PageNumber] }` |
| ImageRun | `"ImageRun"` | `[]` | no | `w:drawing` | `ImageProps` |
| SymbolRun | `"SymbolRun"` | `[]` | no | `w:sym` | `docx.ISymbolRunOptions` |
| ExternalHyperlink | `"ExternalHyperlink"` | `INLINE` | no | `w:hyperlink` | `{ readonly link: string }` |
| InternalHyperlink | `"InternalHyperlink"` | `INLINE` | no | `w:hyperlink` | `{ readonly anchor: string }` |
| Bookmark | `"Bookmark"` | `INLINE` | no | `w:bookmarkStart` | `{ readonly id: string }` |
| PageBreak | `"PageBreak"` | `[]` | no | `w:br` | `{}` |
| Math | `"Math"` | `["MathRun"]` | no | `m:oMath` | `{}` |
| MathRun | `"MathRun"` | `[]` | **yes** | `m:r` | `{}` |

```ts
export type StylesProps = Omit<docx.IStylesOptions, "importedStyles" | "initialStyles">;      // unit 05 adds importedStyles
export type DocumentProps = Omit<docx.IPropertiesOptions, "sections" | "footnotes" | "comments" | "externalStyles" | "styles">
  & { readonly styles?: StylesProps };
type RasterImage = { readonly type: "jpg" | "png" | "gif" | "bmp"; readonly data: Uint8Array };
export type ImageProps = Omit<docx.IImageOptions, "type" | "data" | "fallback">
  & (RasterImage | { readonly type: "svg"; readonly data: Uint8Array; readonly fallback: RasterImage });

export const ELEMENTS = { /* the table above */ } as const satisfies Record<string, Spec<unknown>>;
export type Kind = keyof typeof ELEMENTS;
export type Props<K extends Kind> = NonNullable<(typeof ELEMENTS)[K]["props"]>;
type ChildKind<K extends Kind> = (typeof ELEMENTS)[K]["children"][number] & Kind;
type Strings<K extends Kind> = (typeof ELEMENTS)[K]["text"] extends true ? string : never;
export type Node<K extends Kind = Kind> = K extends Kind
  ? { readonly type: K; readonly props: Props<K>; readonly children: readonly (Node<ChildKind<K>> | Strings<K>)[] }
  : never;
export type DocumentNode = Node<"Document">;
export const isKind = (type: string): type is Kind => Object.hasOwn(ELEMENTS, type);
```

`text` must be typed as a literal (`true`/`false`) per row so that `Strings<K>` resolves. Write rows as `spec<…>({ …, text: true as const })` or pass the whole table through `as const`.

**Check type-checking cost first.** After writing the table, run `time pnpm run type-check`. If it takes over 30 seconds, or errors with "Type instantiation is excessively deep", replace the recursive `Node<K>` with hand-written per-kind node interfaces (`ParagraphNode { type: "Paragraph"; props: …; children: readonly InlineNode[] }` and so on). Then add a test asserting that each interface's child union matches `ELEMENTS[k].children`. Record the choice in the unit's Landed line, because phase 2 imports these types.

### 2. `src/schema/docx-facts.ts`

Facts about docx.js 9.5.1's behavior that canonicalization depends on. Each one is pinned by a test.

```ts
/** Strings docx.js turns into fields when they are run children. Values of docx.PageNumber. */
export const PAGE_NUMBER_VALUES = ["CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", "SECTION"] as const;

/** docx.js's built-in style ids → their IDefaultStylesOptions key, and which kind of options that key takes. */
export const DEFAULT_STYLE_SLOTS = {
  Title: { key: "title", kind: "paragraph" }, Heading1: { key: "heading1", kind: "paragraph" }, /* … Heading2–6 */
  Strong: { key: "strong", kind: "paragraph" }, ListParagraph: { key: "listParagraph", kind: "paragraph" },
  Hyperlink: { key: "hyperlink", kind: "character" }, FootnoteReference: { key: "footnoteReference", kind: "character" },
  FootnoteText: { key: "footnoteText", kind: "paragraph" }, FootnoteTextChar: { key: "footnoteTextChar", kind: "character" },
} as const;

/** Boolean options docx.js writes identically for `true` and `false`. Found by test/presence-booleans.test.ts. */
export const PRESENCE_ONLY: { readonly [K in Kind]?: readonly string[] } = { /* fill from the probe, see Change 6 */ };
```

The `DEFAULT_STYLE_SLOTS` kinds come from `IDefaultStylesOptions` in `node_modules/docx/dist/index.d.ts`, about line 1001. `strong` is typed `IBaseParagraphStyleOptions` there, so it is "paragraph".

`PRESENCE_ONLY` paths are dot paths relative to the kind's props, for example `"tableHeader"` on TableRow and `"properties.titlePage"` on Section.

### 3. `src/tree/canonical.ts`: the rules

```ts
export type AuthorNode = { readonly type: string; readonly props: Readonly<Record<string, unknown>>; readonly children: readonly (AuthorNode | string)[] };
export class TreeError extends Error {
  constructor(readonly path: readonly string[], message: string) { super(`${path.join(" > ")}: ${message}`); this.name = "TreeError"; }
}
/** Pure. Never mutates its input. canonicalize(canonicalize(x)) deep-equals canonicalize(x). */
export function canonicalize(root: AuthorNode): DocumentNode;
```

**Paths.** A path segment is `Kind[i]`, where `i` is the child's index among its parent's authored children. The root is just `"Document"`. Example: `["Document", "Section[0]", "Paragraph[3]", "TextRun[1]"]`.

**Accepted types.** Accepted author types are every `Kind` plus the sugar types `"List"`, `"ListItem"` and `"Break"`. Anything else throws `TreeError(path, "Unknown element <X>")`. The root must be `Document`, otherwise it throws `"The root must be <Document>, got <X>"`.

The rules are applied in a single top-down pass. Each rule also has a test:

1. **Strings directly in a `TextRun`.** A string exactly equal to one of `PAGE_NUMBER_VALUES` becomes `{ type: "PageNumber", props: { field: <that value> }, children: [] }`, which is folio's idiom. Any other string stays literal. Empty strings are dropped, and adjacent strings are merged.
2. **Strings directly in an `INLINE`-holding kind** (Paragraph, ExternalHyperlink, InternalHyperlink, Bookmark). Consecutive strings are merged and wrapped as `TextRun { props: {}, children: [merged] }`, and they are **always literal**. Rule 1 does not apply to them. Today a string directly in a Paragraph is written as `new docx.TextRun({ text })`, which is literal, so this keeps that behavior.
3. **Strings in `MathRun`** are literal. Strings directly in `Math` are wrapped as `MathRun { children: [string] }`. Strings anywhere else throw `TreeError(path, "Text is not allowed directly in <Kind>")`.
4. **The `text` prop.**
   - On `TextRun`, it is removed and its value becomes the first child, as a literal string. Rule 1 does not apply to a `text` value.
   - On `Paragraph` and `ListItem`, it is removed and `TextRun { children: [text] }` is inserted as the first child.
   - On `Math`, it is removed and `MathRun { children: [text] }` is inserted as the first child.
   - When `text` and children are both present, both are kept, `text` first. That matches docx.js's construction order for Paragraph. For TextRun, docx.js silently drops `text` in that case; canonicalization keeps it on purpose.
5. **Run content in an INLINE slot.** `Tab` or `PageNumber` standing directly in an `INLINE`-holding kind is wrapped as `TextRun { props: {}, children: [it] }`. Today `<Paragraph><Tab/></Paragraph>` writes `<w:r><w:tab/></w:r>`, and so will the wrapper.
6. **`Break` sugar.**
   - In an `INLINE` slot, it becomes `TextRun { props: { break: 1 }, children: [] }`. Consecutive Breaks merge into one `break: n`.
   - Inside a `TextRun` with props `P`, the TextRun's children are split at each Break:
     - The content before the first Break stays in a run with `P`.
     - The content after a run of k consecutive Breaks goes into a new run with `{ ...P, break: k }`.
     - If the TextRun has no content before its first Break, the k Breaks add to its own leading count instead (`break: (P.break ?? 0) + k`).
     - A trailing Break produces a final run with no children and `break: k`.
   - Anywhere else, Break throws.
7. **`heading` on Paragraph and ListItem.** If `style` is unset, `heading` becomes `style`. If `style` equals `heading`, drop `heading`. If they differ, throw `TreeError(path, 'heading="X" and style="Y" conflict; use one')`.
8. **Presence-only booleans.** Remove every `PRESENCE_ONLY[kind]` path whose value is `false`. A nested path like `properties.titlePage` is removed from its parent object; if that leaves the parent empty, the empty object stays.
9. **Header and Footer.** A missing `type` becomes `"default"`. A second Header (or Footer) with the same type in one Section throws.
10. **Placement.** Once rules 1–9 have run, every child's kind must be in `ELEMENTS[parent].children`, or the parent must accept strings. Otherwise throw `TreeError(childPath, "<Child> is not allowed in <Parent>")`. `List` and `ListItem` are handled by Change 4 before this check.
11. **Image data.** A string `data` is base64 (an optional `data:…;base64,` prefix is stripped) and is decoded with `atob`, not `Buffer`. An `ArrayBuffer` is wrapped. A Node `Buffer` (a `Uint8Array` subclass) is copied into a plain `Uint8Array`. The same applies to `fallback.data`.
12. **Style folding (decision 7).** For each entry in `Document.props.styles.paragraphStyles` and `characterStyles` whose `id` is a key of `DEFAULT_STYLE_SLOTS`:
    - Remove it from the list.
    - Set `styles.default[slot.key]` to the entry without `id`. This replaces any existing `styles.default[slot.key]`.
    - Throw if a `paragraphStyles` entry targets a `"character"` slot, or a `characterStyles` entry targets a `"paragraph"` slot.
    - Drop a list that ends up empty.

Props are otherwise passed through untouched, and they are not validated: TSX already type-checked them.

### 4. `src/tree/lists.ts`: List expansion (decision 11)

```ts
/** Levels 0–8 for "NumberedList" and "BulletList". Level 0 is identical to today's DEFAULT_NUMBERING (src/constants.ts). */
export const LIST_NUMBERING: { readonly config: readonly docx.INumberingOptions["config"][number][] };
```

- **Levels.** Level `n` has `style.paragraph.indent = { left: 720 * (n + 1), hanging: 360 }` and `alignment: "left"`.
- **NumberedList.** The `format` cycles `decimal`, `lowerLetter`, `lowerRoman` by `n % 3`, and the `text` is `%${n + 1}.`.
- **BulletList.** The `format` is `"bullet"`, and the `text` cycles `"•"`, `"◦"`, `"▪"`.
- **Level 0 must equal today's.** It must equal the level-0 entry of `DEFAULT_NUMBERING` in `src/constants.ts` exactly. Test that.

**Expansion in a block slot** (Section, Header, Footer, TableCell):
- `List { type?: "bullet" | "numbered" }` expands into Paragraphs. `type` defaults to `"bullet"`, as today. The reference is `"NumberedList"` for numbered and `"BulletList"` otherwise.
- Each top-level List takes the next instance from a counter that starts at **0** and is shared across the document, in document order. Starting at 0 keeps a document with one list numbered exactly as today: docx.js's default instance is 0.
- A `ListItem` child becomes a `Paragraph` whose props are the ListItem's props after rules 4 and 7, plus `numbering: { reference, level, instance }`.
- Nesting:
  - A `List` child of a `List` expands at `level + 1` with the same instance.
  - A `List` child of a `ListItem` splits the item: the item's non-List children form its paragraph, and the nested List's paragraphs follow it at `level + 1`.
- A `level` prop on List is ignored (decision 11 removes it). If it is present, throw `TreeError(path, "List.level was removed; nest <List> instead")` so that silent level changes surface.

**Other placements.**
- A `ListItem` outside a List becomes a plain `Paragraph` with its props, which keeps today's behavior.
- `List` anywhere other than a block slot or a List/ListItem throws.

**Numbering config.** If any List was expanded, add each `LIST_NUMBERING` config whose `reference` is not already in `Document.props.numbering.config`. Users who pass their own `"NumberedList"` config keep theirs. This replaces `ensureNumberingConfig` in `src/renderer.ts`, which unit 04 deletes.

### 5. `test/canonical.test.ts` (AC7)

Build inputs with `test/support/nodes.ts`'s `n(type, props = {}, ...children)`. Write one `test` per rule above (1–12) and per List behavior. Also include:

- **Idempotence:** for every input used in the file, `canonicalize(canonicalize(x))` deep-equals `canonicalize(x)`.
- **Purity:** `canonicalize` leaves its input deep-equal to a `structuredClone` taken before the call.
- **`TreeError.path`:** two placement errors with the exact path asserted.
- **Folio's idioms:**
  - `n("TextRun", { children: undefined }, "Page ", "CURRENT")` gives `["Page ", PageNumber CURRENT]`.
  - `heading: "Heading1"` gives `style: "Heading1"`.
  - `styles.default.heading1` passes through untouched.

### 6. `test/presence-booleans.test.ts` (AC8)

Read `node_modules/docx/dist/index.d.ts` and list every `boolean`-typed option key (including keys from intersected types) of `IParagraphOptions`, `IRunOptions`, `ITableOptions`, `ITableRowOptions`, `ITableCellOptions`, and `ISectionOptions["properties"]` (for example `titlePage`). Put that list in the test as a literal table of `{ kind, path }`.

For each entry, build three minimal documents directly with docx.js: option absent, `true`, and `false`. Unzip `word/document.xml` with the unit-01 helper `docxXml`. The option is **presence-only** if and only if `xml(false) === xml(true)` and `xml(false) !== xml(absent)`. Options where `false` writes its own value, such as `bold: false` writing `w:val="false"`, are not presence-only.

Assert that the probed set equals `PRESENCE_ONLY`, and print the set with `console.info`. Fill `PRESENCE_ONLY` from the first run's output. The known member is `TableRow: ["tableHeader"]` (documented in `folio/packages/dsl/CLAUDE.md`).

## Verify

```sh
pnpm test -- test/canonical.test.ts test/presence-booleans.test.ts
pnpm test               # characterization snapshots unchanged: nothing is wired yet
pnpm run type-check
```

The presence-booleans test prints the probed set. Copy it into the Landed line, because phase 2's reader relies on it.

## Watch out

- Do not change `src/constants.ts` here. `DEFAULT_NUMBERING` is read by the writer that is still live; extending it would change the `bug-lists` snapshot one unit early. Unit 04 points `DEFAULT_NUMBERING` at `LIST_NUMBERING`.
- Rule 2 versus rule 1 is the trap. A string `"CURRENT"` written directly in a Paragraph must stay literal text. Only strings that are direct children of `TextRun` become fields.
- `atob` exists in Node 16+ and in browsers. Do not use `Buffer.from(…, "base64")`; phase 2 runs this code in the browser.
- **Files under `src/schema/` and `src/tree/` must never import `docx` at runtime.** Use only `import type`. Phase 2's `@react-docx/core/html` bundle re-exports `renderToTree`, and a bundle-isolation test fails if docx.js reaches it. In `src/tree/lists.ts`, write level formats as string literals (`"decimal"`, `"lowerLetter"`, `"lowerRoman"`, `"bullet"`, `"left"`), not `docx.LevelFormat.DECIMAL`. Check with `grep -rn 'from "docx"' src/schema src/tree | grep -v "import type"`, which must print nothing.
