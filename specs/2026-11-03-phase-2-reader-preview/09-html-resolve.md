# 09 — The preview's style resolution: `resolveDocument`

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC12
- **You will see**: `resolveDocument(renderToTree(<Document><Section><Paragraph heading={HeadingLevel.HEADING_1}>Title</Paragraph></Section></Document>))` returns plain data. The paragraph's computed run shows `color: "2E74B5"` and `sizePt: 16`, which are docx.js's built-in Heading1 values, even though the document never defined Heading1. A read Word file shows its own `Normal` font and its table style borders.

## Goal

Compute, for every block and run in a canonical tree, the formatting Word would apply. That covers docx.js's default styles, the document's styles (including raw ones), the `basedOn` chains, list levels and direct properties. Also compute list marker text and CSS values.

The output is plain data, so it can be tested without React. Unit 10 draws it.

## Files

- `scripts/generate-default-styles.ts`: new. Writes the snapshot.
- `src/html/docx-default-styles.generated.ts`: new, generated. Commit it.
- `src/html/sheet.ts`: new. `effectiveSheet`.
- `src/html/resolve.ts`: new. `resolveDocument` and the `Resolved*` types.
- `src/html/css.ts`: new. Computed values → `React.CSSProperties`.
- `src/ooxml/style.ts`: add `readStyleForPreview` (Change 2).
- `package.json`: add `"generate:styles": "tsx scripts/generate-default-styles.ts"`.
- `test/html-resolve.test.ts`: new (AC12).

## Changes

### 1. The default-style snapshot (decision 14)

`scripts/generate-default-styles.ts`:
1. `readDocx(await renderToBuffer(<Document><Section><Paragraph /></Section></Document>))`.
2. Take `document.props.styles`. It holds docx.js's docDefaults and its 13 default styles, folded into `styles.default.*` by canonicalize.
3. Write `src/html/docx-default-styles.generated.ts` as `export const DOCX_DEFAULT_STYLES: StylesProps = <JSON>;`, with a header comment naming the script and the docx.js version from `node_modules/docx/package.json`.

Verified 2026-11-03: docx.js writes `<w:docDefaults><w:rPrDefault/><w:pPrDefault/></w:docDefaults>`, which is empty, and Heading1 with `color 2E74B5` and `sz 32`.

**Drift test.** Run the same steps in-process and `toEqual` the committed constant. On a docx.js upgrade this fails until someone runs `pnpm run generate:styles`.

### 2. `effectiveSheet` (`src/html/sheet.ts`)

```ts
export type SheetStyle = {
  readonly type: "paragraph" | "character" | "table";
  readonly basedOn?: string;
  readonly paragraph?: ParagraphOptions; readonly run?: RunOptions; readonly table?: TableOptions;
};
export type EffectiveSheet = {
  readonly docDefaults: { readonly paragraph: ParagraphOptions; readonly run: RunOptions };
  readonly styles: ReadonlyMap<string, SheetStyle>;
  readonly defaultParagraphStyle: string | null;      // the raw style with w:default="1", if any
};
export function effectiveSheet(styles: StylesProps | undefined): EffectiveSheet;
```

Build it the way docx.js builds `styles.xml`:

- **docDefaults.** `styles.default.document` if present, otherwise the snapshot's. docx.js does `new DocumentDefaults(options.document ?? {})`, which replaces rather than merges.
- **The 13 defaults.** For each `DEFAULT_STYLE_SLOTS` entry: `{ ...DOCX_DEFAULT_STYLES.default[key], ...styles.default[key] }`, a shallow spread (verified in docx.js's `DefaultStylesFactory`: `new Heading1Style({ run: {…}, ...options.heading1 })`). The id comes from `DEFAULT_STYLE_SLOTS`.
- **Document styles.** `paragraphStyles` and `characterStyles` by `id`.
- **Raw styles.** For each `importedStyles` string, `parseXml` it and call `readStyleForPreview` (below). A raw style with `w:default="1"` sets `defaultParagraphStyle`.

**`readStyleForPreview(style, env): { id, sheet: SheetStyle, isDefault }`** goes in `src/ooxml/style.ts`. It maps any `w:style` with the unit 02–03 codecs, whatever its type:
- `w:pPr` → `paragraph`, `w:rPr` → `run`;
- `w:tblPr` → `table`, with `readTableProperties` on a synthetic `w:tbl` that wraps the `w:tblPr`;
- `w:tblStylePr` (conditional formatting for the first row, banding, …) is ignored. That is a preview simplification, recorded under Watch out.

The env is empty: theme values were already resolved by the reader.

### 3. `resolveDocument` (`src/html/resolve.ts`)

```ts
export type ComputedRun = {
  readonly fontFamily: string; readonly sizePt: number; readonly bold: boolean; readonly italic: boolean;
  readonly underline: string | null; readonly strike: boolean; readonly doubleStrike: boolean;
  readonly color: string | null; readonly highlight: string | null; readonly background: string | null;
  readonly allCaps: boolean; readonly smallCaps: boolean; readonly verticalAlign: "super" | "sub" | null;
  readonly letterSpacingPt: number; readonly hidden: boolean;
};
export type ComputedParagraph = {
  readonly align: "left" | "center" | "right" | "justify" | "start" | "end";
  readonly spaceBeforePt: number; readonly spaceAfterPt: number;
  readonly lineHeight: { readonly kind: "multiple"; readonly value: number } | { readonly kind: "exact" | "atLeast"; readonly pt: number };
  readonly indentLeftPt: number; readonly indentRightPt: number; readonly firstLinePt: number;   // negative = hanging
  readonly borders: Partial<Record<"top" | "bottom" | "left" | "right", ComputedBorder>>;
  readonly background: string | null; readonly pageBreakBefore: boolean; readonly markRun: ComputedRun;
};
export type ComputedBorder = { readonly style: "solid" | "double" | "dashed" | "dotted"; readonly widthPt: number; readonly color: string };
export type ResolvedInline =
  | { readonly kind: "text"; readonly text: string; readonly run: ComputedRun }
  | { readonly kind: "tab" | "lineBreak" | "pageBreak" | "columnBreak" }
  | { readonly kind: "field"; readonly placeholder: string; readonly run: ComputedRun }        // PageNumber → "#", dates → "date"
  | { readonly kind: "image"; readonly src: string; readonly widthPx: number; readonly heightPx: number; readonly alt: string; readonly floating: boolean }
  | { readonly kind: "link"; readonly href: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "anchor"; readonly id: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "footnoteRef"; readonly n: number; readonly run: ComputedRun }
  | { readonly kind: "raw"; readonly element: string };
export type ResolvedBlock =
  | { readonly kind: "paragraph"; readonly path: TreePath; readonly format: ComputedParagraph; readonly marker: { readonly text: string; readonly run: ComputedRun; readonly suffix: "tab" | "space" | "nothing" } | null; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "table"; readonly path: TreePath; readonly widthPt: number | null; readonly columnWidthsPt: readonly number[]; readonly rows: readonly ResolvedRow[] }
  | { readonly kind: "textbox"; readonly path: TreePath; readonly widthPt: number | null; readonly heightPt: number | null; readonly blocks: readonly ResolvedBlock[] }
  | { readonly kind: "raw"; readonly path: TreePath; readonly element: string };
export type ResolvedRow = { readonly heightPt: number | null; readonly isHeader: boolean; readonly cells: readonly ResolvedCell[] };
export type ResolvedCell = { readonly colSpan: number; readonly rowSpan: number; readonly widthPt: number | null; readonly background: string | null;
  readonly borders: ComputedParagraph["borders"]; readonly verticalAlign: "top" | "center" | "bottom"; readonly blocks: readonly ResolvedBlock[] };
export type ResolvedSection = {
  readonly path: TreePath; readonly widthPt: number; readonly heightPt: number;
  readonly marginsPt: Readonly<Record<"top" | "right" | "bottom" | "left", number>>;
  readonly header: readonly ResolvedBlock[]; readonly body: readonly ResolvedBlock[]; readonly footer: readonly ResolvedBlock[];
  readonly footnotes: readonly { readonly n: number; readonly blocks: readonly ResolvedBlock[] }[];
};
export function resolveDocument(document: DocumentNode): readonly ResolvedSection[];
```

**Page size and margins.** These come from `Section.props.properties.page`, falling back to docx.js's defaults (verified 2026-11-03 from an empty docx.js document): A4 width 11906, height 16838, margins 1440 on every side. Twips ÷ 20 gives pt.

**Headers and footers.** Only `type: "default"` ones are shown (Out of Scope). `path` is the canonical block path, the same scheme as `TreePath` in unit 04.

**The cascade, applied lowest first:**

- **Paragraph:**
  1. `docDefaults.paragraph`;
  2. the paragraph style chain: `style ?? defaultParagraphStyle`, walking `basedOn` up to 10 hops (as folio's `styleChain`), applied base first;
  3. the numbering level's `style.paragraph` when the paragraph has `numbering`;
  4. the paragraph's direct props.
- **Run:**
  1. `docDefaults.run`;
  2. the paragraph style chain's `run`;
  3. the character style chain (`TextRun.style`);
  4. the run's direct props.
- **Nested objects** (`spacing`, `indent`, `font`) merge per key. Scalars override.
- **Booleans.** Use plain override precedence. Word's toggle semantics, where `bold` in a character style flips the paragraph style's bold, are not modeled; recorded under Watch out.
- **Fallbacks.** When nothing sets a font or size, use `FALLBACK_RUN = { font: "Times New Roman", size: 20 }`, the OOXML application defaults. Unit 10's checkpoint confirms this against Word for a docx.js document with no styles. Record what it showed.
- **Font.** `fontFamily` comes from `font` (a string, or `ascii` from the object) and is quoted for CSS.

**Values:**
- `sizePt` = `size / 2`.
- `letterSpacingPt` = `characterSpacing / 20`.
- `lineRule` `auto` (or absent) gives `{ multiple: line / 240 }`. `exact` and `atLeast` give `pt: line / 20`. With no `line`, the result is `{ multiple: 1 }`.
- `firstLinePt` = `firstLine / 20`, or `-hanging / 20`.
- Border `widthPt` = `size / 8`. `single` → `solid`; `double`, `dashed` and `dotted` map to themselves; `nil`/`none` → absent; other styles → `solid`.
- `alignment` `both` and `distribute` → `justify`.

**Markers.**
- Walk the document in order with phase-2 unit 05's `markerText` and a `Counters` keyed by `reference:instance`. The levels come from `Document.props.numbering.config`, by `reference`.
- The marker's run is the level's `style.run` over the paragraph's mark run.
- The suffix is the level's `suffix` (default `tab`).

**Inlines.**
- `TextRun`: `props.text`, when present, → one `text` (phase 1 keeps a literal page-number value or `""` there, in a run with no children); strings → `text`; `Tab` → `tab`; `break: n` → n `lineBreak`s first.
- `CarriageReturn` → `lineBreak`; `PageBreak` → `pageBreak`; `ColumnBreak` → `columnBreak`.
- `SoftHyphen` → text `"­"`; `NoBreakHyphen` → `"‑"`; `PositionalTab` → `tab`.
- `SymbolRun` → text `String.fromCodePoint(parseInt(char, 16))` with the symbol font.
- `PageNumber` → `field` `"#"`; Day/Month/Year → `field` `"date"`.
- `SimpleField` → text `cachedValue ?? ""`; `SimpleMailMergeField` → text `«name»`; `SequentialIdentifier` and `PageReference` → `field` `"#"`.
- `CheckBox` → `"☒"`/`"☐"`.
- `InsertedTextRun` → as TextRun. `DeletedTextRun` → nothing. Comment ranges and references → nothing.
- `ExternalHyperlink` → `link`; `InternalHyperlink` → `link` `#anchor`; `Bookmark` → `anchor`.
- `Math` → text of its MathRuns in italic.
- `Footnote` → `footnoteRef` n (body order per document) plus its blocks in the section's `footnotes`.
- `ImageRun` → `image` with `src` = `data:image/<png|jpeg|gif|bmp|svg+xml>;base64,<btoa over the bytes in 32 KiB chunks>` (no `Buffer`), and `floating: !!floating`.
- `RawXml` → `raw` with its first root's name.

**Blocks.**
- `TableOfContents` → `raw` `"w:sdt"`.
- `Textbox` → `textbox`, with width and height parsed from `style.width`/`style.height` when they are in `pt`.
- Table cells:
  - `columnSpan` → `colSpan`;
  - `verticalMerge` `"restart"` → `rowSpan` = 1 + the number of directly following rows whose cell at the same grid column is `"continue"`;
  - `"continue"` cells are omitted from the output.

  The grid column is computed from the `colSpan`s.

### 4. `src/html/css.ts`

```ts
export function runStyle(r: ComputedRun): React.CSSProperties;          // pt strings: `${n}pt`; color "#hex"
export function paragraphStyle(p: ComputedParagraph): React.CSSProperties; // margin 0 + explicit margins; lineHeight unitless for multiple, pt otherwise
export function borderCss(b: ComputedBorder): string;                    // `${widthPt}pt ${style} #${color}`
```

Type-only `react` import.

### 5. `test/html-resolve.test.ts` (AC12)

- **Snapshot.** The drift test from Change 1.
- **Built-in styles.** An authored `heading={HEADING_1}` paragraph with no styles defined has `color "2E74B5"` and `sizePt 16`.
- **Overrides.** Authored `styles.default.heading1 = { run: { size: 40 } }` gives `sizePt 20` and `color null`. That is shallow-spread semantics, the same as docx.js writes.
- **Read styles.** From unit 07's `WORD_SHAPED` `resume` fixture, read: body text has the `Normal` raw style's font (Calibri, resolved by the reader); a table with the raw "Table Grid" style has cell borders `0.5pt solid`.
- **Chains.** A `basedOn` chain of 3 styles applies base first.
- **Precedence.** A character style overrides the paragraph style's run, and direct props override both.
- **Markers.** Nested numbered list markers render `1.`, `2.`, `2.1.`; bullets render their lvlText.
- **Units.**
  - `lineRule auto line 276` gives `multiple 1.15`; `exact line 240` gives `12pt`.
  - `hanging 360` gives `firstLinePt -18`.
  - Border `size 4` gives `0.5pt`.
- **Images.** An image gives a `data:image/png;base64,…` src whose decoded bytes equal the input.
- **Merged cells.** `verticalMerge` restart plus 2 continues gives `rowSpan 3`, and the continue cells are omitted.
- **Footnotes.** They are numbered 1..n and collected per section.

## Verify

```sh
pnpm run generate:styles && git diff --exit-code src/html/docx-default-styles.generated.ts
pnpm test -- test/html-resolve.test.ts
pnpm test
pnpm run type-check
```

## Watch out

- Accepted simplifications: no conditional table formatting (`w:tblStylePr`), no toggle-property semantics, no font fallback lists. Each one is a preview-fidelity gap, not a reader or writer gap, so leave a comment at each site naming it.
- `src/html/` must not import `docx` at runtime. Use `docx` types only, and the string values docx.js uses (`"both"`, `"auto"`).
- `btoa` takes a binary string. Build it with `String.fromCharCode(...chunk)` per 32 KiB chunk, to stay under the argument-count limit.
