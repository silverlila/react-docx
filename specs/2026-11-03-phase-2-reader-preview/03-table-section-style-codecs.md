# 03 — Table, section, list-level and style codecs

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC5
- **You will see**: `readSectionProperties` turns a Word `w:sectPr` into `{ properties: { page: { size, margin }, titlePage, column } }`. `readStyle` turns a `w:style` into a docx.js `paragraphStyles` entry, or into a raw string when docx.js cannot express it. A writer-inverse test proves every sampled option survives docx.js → codec → docx.js unchanged.

## Goal

Finish the codec layer. This unit covers `w:tblPr`, `w:trPr` and `w:tcPr` (table, row, cell), `w:sectPr` (section), `w:lvl` (one numbering level) and `w:style`. It uses the framework and sub-codecs from unit 02.

## Files

- `src/ooxml/table.ts`: new. `readTableProperties`, `readRowProperties`, `readCellProperties`.
- `src/ooxml/section.ts`: new. `readSectionProperties`.
- `src/ooxml/level.ts`: new. `readLevel`.
- `src/ooxml/style.ts`: new. `readStyle`, `readDocDefaults`.
- `test/support/docx-props.ts`: add extractors for `w:tblPr`, `w:trPr`, `w:tcPr`, `w:sectPr`, `w:lvl` and `w:style`.
- `test/ooxml-table-section-style.test.ts`: new (AC5).

## Changes

### 1. Tables (`src/ooxml/table.ts`)

```ts
export type TableOptions = Omit<docx.ITableOptions, "rows">;
export type RowOptions = Omit<docx.ITableRowOptions, "children">;
export type CellOptions = Omit<docx.ITableCellOptions, "children">;
export function readTableProperties(tbl: XmlElement, env: CodecEnv): CodecResult<TableOptions>;   // takes w:tbl: reads w:tblPr AND w:tblGrid
export function readRowProperties(trPr: XmlElement | null, env: CodecEnv): CodecResult<RowOptions>;
export function readCellProperties(tcPr: XmlElement | null, env: CodecEnv): CodecResult<CellOptions>;
```

| OOXML | option |
|---|---|
| `w:tblStyle@w:val` | `style` |
| `w:tblW` | `width: { size: number(w:w), type: w:type }` |
| `w:tblGrid/w:gridCol@w:w` (sibling of tblPr) | `columnWidths: number[]` |
| `w:tblInd` | `indent: { size, type }` |
| `w:tblLayout@w:type` | `layout` |
| `w:tblBorders` | `borders` (top, bottom, left, right, insideHorizontal ← `w:insideH`, insideVertical ← `w:insideV`), each through unit 02's `readBorder` |
| `w:jc@w:val` | `alignment` |
| `w:bidiVisual` | `visuallyRightToLeft` |
| `w:tblCellMar` | `margins: { top, bottom, left, right, marginUnitType }` from the `w:w`/`w:type` of each side |
| `w:tblpPr` | `float`: `ITableFloatOptions`, from `w:horzAnchor`, `w:vertAnchor`, `w:tblpX`, `w:tblpY`, `w:tblpXSpec`, `w:tblpYSpec`, `w:leftFromText`, `w:rightFromText`, `w:topFromText`, `w:bottomFromText`, plus `w:tblOverlap` as `overlap` |
| `w:tblCellSpacing` | `cellSpacing: { value, type }` |
| row: `w:cantSplit`, `w:tblHeader` | `cantSplit`, `tableHeader` (presence-only rule from unit 02) |
| row: `w:trHeight` | `height: { value: number(w:val), rule: w:hRule ?? "atLeast" }` |
| row: `w:tblCellSpacing` | `cellSpacing` |
| cell: `w:tcW` | `width: { size, type }` |
| cell: `w:gridSpan@w:val` | `columnSpan` |
| cell: `w:vMerge` | `verticalMerge: w:val ?? "continue"` (`"restart"` or `"continue"`) |
| cell: `w:tcBorders` | `borders` (top, bottom, left/start, right/end) |
| cell: `w:shd` | `shading` |
| cell: `w:tcMar` | `margins` |
| cell: `w:vAlign@w:val` | `verticalAlign` |
| cell: `w:textDirection@w:val` | `textDirection` |

**Vertical merges use `verticalMerge`, never `rowSpan`.** Every `w:tc` in the file becomes one TableCell, including continuation cells. `rowSpan` would make docx.js invent continuation cells, so the cell count would change between reads and the round trip would fail.

**Dropped:**
- table: `w:tblLook` (conditional table-style formatting; docx.js has no option), `w:tblCaption`, `w:tblDescription`, `w:tblStyleRowBandSize`, `w:tblStyleColBandSize`, `w:tblPrChange`;
- row: `w:gridBefore`, `w:gridAfter`, `w:wBefore`, `w:wAfter`, `w:jc`, `w:hidden`, `w:trPrChange`;
- cell: `w:noWrap`, `w:tcFitText`, `w:hideMark`, `w:hMerge`, `w:tcPrChange`.

**Ignored:** `w:cnfStyle` in row and cell.

### 2. Sections (`src/ooxml/section.ts`)

```ts
export type SectionRead = CodecResult<{ properties?: docx.ISectionPropertiesOptions }> & {
  readonly references: readonly { readonly kind: "header" | "footer"; readonly type: "default" | "first" | "even"; readonly relId: string }[];
};
export function readSectionProperties(sectPr: XmlElement | null, env: CodecEnv): SectionRead;
```

| OOXML | `properties.` |
|---|---|
| `w:pgSz` | `page.size: { width: w:w, height: w:h, orientation: w:orient }` |
| `w:pgMar` | `page.margin: { top, right, bottom, left, header, footer, gutter }` |
| `w:pgNumType` | `page.pageNumbers: { start: w:start, formatType: w:fmt, separator: w:chapSep }` |
| `w:pgBorders` | `page.borders`: `{ pageBorders: { display, offsetFrom, zOrder }, pageBorderTop/Right/Bottom/Left }` |
| `w:textDirection` | `page.textDirection` |
| `w:docGrid` | `grid: { linePitch, charSpace, type }` |
| `w:lnNumType` | `lineNumbers: { countBy, start, restart, distance }` |
| `w:titlePg` | `titlePage` |
| `w:vAlign` | `verticalAlign` |
| `w:cols` | `column: { space, count, separate: isOn(w:sep), equalWidth: isOn(w:equalWidth), children }` from `w:col` |
| `w:type@w:val` | `type` |
| `w:headerReference`, `w:footerReference` | not options; returned in `references` |

- **Dropped:** `w:formProt`, `w:rtlGutter`, `w:bidi`, `w:paperSrc`, `w:printerSettings` (it carries `r:id`), `w:footnotePr`, `w:endnotePr`, `w:noEndnote`, `w:sectPrChange`.
- **Mirror margins and even/odd headers** live in `word/settings.xml`, not here, so this codec does not see them. Unit 04 reads `w:evenAndOddHeaders` into `Document.evenAndOddHeaderAndFooters`.

### 3. List levels (`src/ooxml/level.ts`)

```ts
export function readLevel(lvl: XmlElement, env: CodecEnv): CodecResult<docx.ILevelsOptions>;
```

| OOXML | option |
|---|---|
| `w:ilvl` | `level` |
| `w:start@w:val` | `start` |
| `w:numFmt@w:val` | `format` |
| `w:lvlText@w:val` | `text` |
| `w:lvlJc@w:val` | `alignment` |
| `w:suff@w:val` | `suffix` |
| `w:isLgl` | `isLegalNumberingStyle` |
| `w:pPr` | `style.paragraph`, through `readParagraphProperties(...).options` |
| `w:rPr` | `style.run`, through `readRunProperties` |

- **Dropped:** `w:lvlRestart`, `w:lvlPicBulletId`, `w:legacy`, `w:pStyle`.
- **Ignored:** the `w:tplc` and `w:tentative` attributes. Those are attributes and never reported, per unit 02.

### 4. Styles (`src/ooxml/style.ts`)

```ts
export type StyleRead =
  | { readonly kind: "paragraph"; readonly options: docx.IParagraphStyleOptions; readonly numPr: { numId: string; level: number } | null; readonly notes: readonly Note[] }
  | { readonly kind: "character"; readonly options: docx.ICharacterStyleOptions; readonly notes: readonly Note[] }
  | { readonly kind: "raw"; readonly xml: string; readonly because: "default" | "table" | "numbering" };
export function readStyle(style: XmlElement, env: CodecEnv): StyleRead | { readonly kind: "dropped"; readonly because: string };
/** w:docDefaults → docx.js IDocumentDefaultsOptions { paragraph, run }. */
export function readDocDefaults(docDefaults: XmlElement | null, env: CodecEnv): CodecResult<docx.IDocumentDefaultsOptions>;
```

- **Raw cases.** `w:default="1"` (or `"true"`) on a paragraph style gives raw `"default"`, because docx.js's `StyleForParagraph` never writes `w:default`. `w:type="table"` gives raw `"table"`, and `w:type="numbering"` gives raw `"numbering"`. The raw `xml` is `serializeXml(style)`.
  - If the element contains an `r:` attribute, return `dropped`. RawXml may not carry relationships (phase 1 decision 10).
  - A character style with `w:default="1"` (usually `DefaultParagraphFont`) is also raw `"default"`.
- **Options.**
  - `w:styleId` → `id`.
  - `w:name` → `name`, `w:basedOn` → `basedOn`, `w:next` → `next`, `w:link` → `link`, `w:uiPriority` → `uiPriority`.
  - `w:semiHidden`, `w:unhideWhenUsed` and `w:qFormat` → `semiHidden`, `unhideWhenUsed` and `quickFormat`, all through `isOn`.
  - `w:pPr` → `paragraph`, without its `style` key. `w:rPr` → `run`.
  - A paragraph style's `w:pPr/w:numPr` is returned as `numPr`. Unit 05 maps it to `paragraph.numbering`.
- **Dropped:** `w:aliases`, `w:autoRedefine`, `w:hidden`, `w:locked`, `w:personal`, `w:personalCompose`, `w:personalReply`, and `w:tblPr`/`w:trPr`/`w:tcPr` inside a non-table style.
- **Ignored:** `w:rsid`, the element form.

### 5. Extractors (`test/support/docx-props.ts`)

Add these, each building a minimal docx.js document and returning the first matching element's outer XML:
- `tablePropertiesXml(options)`, which returns `w:tblPr` followed by `w:tblGrid`;
- `rowPropertiesXml(options)`;
- `cellPropertiesXml(options)`;
- `sectionPropertiesXml(properties)`, from the body's last `w:sectPr`;
- `levelXml(level)`, from `word/numbering.xml` for a config with that one level;
- `styleXml(paragraphStyle | characterStyle)`, from `word/styles.xml` by `w:styleId`;
- `docDefaultsXml(document)`.

### 6. `test/ooxml-table-section-style.test.ts` (AC5)

**The writer-inverse test.** Use the same three steps as unit 02 (write with docx.js, read with the codec, write again, then require identical XML and no `dropped` notes). Run it over a sample table per codec, with at least one sample per mapped row. Include:
- `columnWidths: [3000, 6000]`
- `borders` with `insideHorizontal`
- `float: { horizontalAnchor: "margin", absoluteHorizontalPosition: 100 }`
- `height: { value: 400, rule: "exact" }`
- `columnSpan: 2`
- `verticalMerge: "restart"`
- `verticalMerge: "continue"`
- `page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 } }`
- `titlePage: true`
- `column: { count: 2, space: 708 }`
- `level: { level: 0, format: "decimal", text: "%1.", alignment: "left", style: { paragraph: { indent: { left: 720, hanging: 360 } } } }`
- a paragraph style with `basedOn`, `next`, `quickFormat`, `paragraph` and `run`
- a character style

**The hand-written cases:**
- `w:vMerge` with no `w:val` gives `"continue"`.
- `w:tblLook` gives `dropped`.
- A Word `Normal` style with `w:default="1"` gives raw `"default"`, with `xml` equal to its serialized input.
- `w:type="table"` "Table Grid" gives raw `"table"`.
- A style containing `r:id` gives `dropped`.
- `readSectionProperties` returns three `references` for a `w:sectPr` with default/first header references and a default footer reference.
- A `w:printerSettings r:id` gives `dropped`.

## Verify

```sh
pnpm test -- test/ooxml-table-section-style.test.ts
pnpm test
pnpm run type-check
```

## Watch out

- docx.js's character-style constructor adds `uiPriority: 99` and `unhideWhenUsed: true` when absent. In the writer-inverse test, give character style samples both keys explicitly, so `x2 === x1` compares like with like. Decision 10 explains why Word files still round trip after one write.
- `readTableProperties` takes the whole `w:tbl`, because `columnWidths` lives in the sibling `w:tblGrid`.
- `verticalMerge` versus `rowSpan` is the main trap in this unit. See the bold paragraph in Change 1.
