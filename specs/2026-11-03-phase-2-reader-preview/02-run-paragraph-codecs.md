# 02 — Run and paragraph property codecs

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC4
- **You will see**: `readRunProperties(parseXml('<w:rPr><w:b/><w:color w:val="FF0000"/><w:sz w:val="28"/><w14:ligatures w14:val="all"/></w:rPr>'), env)` returns `{ options: { bold: true, color: "FF0000", size: 28 }, notes: [{ fate: "dropped", element: "w14:ligatures", … }] }`. A test proves that for every sampled option, docx.js's output read back and written again is byte-identical.

## Goal

Add `src/ooxml/`. It holds the codec framework (env, notes, fate tables, unit helpers) and the two most-used codecs, `w:rPr` → run options and `w:pPr` → paragraph options. The reader (unit 04) uses them for runs, paragraphs and styles, and the HTML resolver (unit 08) uses them for raw styles.

## Files

- `src/ooxml/codec.ts`: new. `CodecEnv`, `Note`, `CodecResult`, `Fate`, the theme resolution helpers.
- `src/ooxml/run.ts`: new. `readRunProperties` and `RPR_FATES`.
- `src/ooxml/paragraph.ts`: new. `readParagraphProperties` and `PPR_FATES`. Shared sub-codecs: borders, shading, spacing, indent, tabs.
- `test/support/docx-props.ts`: new. Extracts the `w:rPr`/`w:pPr` that docx.js writes for given options.
- `test/ooxml-run-paragraph.test.ts`: new (AC4).

## Changes

### 1. The framework (`src/ooxml/codec.ts`)

```ts
import type { XmlElement } from "../read/xml";
import type { OpcPackage } from "../read/package";

export type CodecEnv = { readonly theme: OpcPackage["theme"] };
export type Note = { readonly fate: "resolved" | "dropped" | "ignored"; readonly element: string; readonly detail: string };
export type CodecResult<T> = { readonly options: T; readonly notes: readonly Note[] };

/** How one OOXML child element is handled. `read` writes into the options being built and may push notes. */
export type Fate<T> =
  | { readonly fate: "mapped"; readonly read: (el: XmlElement, out: Partial<Mutable<T>>, env: CodecEnv, notes: Note[]) => void }
  | { readonly fate: "ignored" }
  | { readonly fate: "dropped"; readonly why: string };
export type FateTable<T> = Readonly<Record<string, Fate<T>>>;   // keyed by qualified child name

/** Walks el's element children; children not in the table → a "dropped" note (decision 6). */
export function applyFates<T>(el: XmlElement | null, table: FateTable<T>, env: CodecEnv): CodecResult<T>;

/** Theme colour: hex if w:val is a 6-digit hex; else the theme colour named by w:themeColor, with w:themeTint/w:themeShade
 *  applied (tint: c·t + 255·(1−t); shade: c·s; t, s = hex byte / 255), with a "resolved" note; else null ("auto"). */
export function colorOf(el: XmlElement, env: CodecEnv, notes: Note[]): string | null;
/** themeColor → clrScheme key: dark1|text1→dk1, light1|background1→lt1, dark2|text2→dk2, light2|background2→lt2,
 *  accent1–6→same, hyperlink→hlink, followedHyperlink→folHlink. */
export const THEME_COLOR_KEYS: Readonly<Record<string, string>>;
```

`Mutable<T>` strips `readonly`. It is local to this file. The codec builds a plain object and returns it as `T`.

**Rules for theme colours.**
- Word writes the computed colour in `w:val` next to `w:themeColor`. So when `w:val` is a hex, use it and add **no** note: the literal is already in the file.
- Resolve from the theme only when `w:val` is absent or `auto`. A theme key missing from the file's theme gives `dropped`.

### 2. `src/ooxml/run.ts`

```ts
export type RunOptions = Omit<docx.IRunOptions, "children" | "text" | "break">;   // type-only import of docx
export const RPR_FATES: FateTable<RunOptions>;
export function readRunProperties(rPr: XmlElement | null, env: CodecEnv): CodecResult<RunOptions>;
```

**Mapped.** Each OOXML element maps to docx.js's option key. docx.js 9.5.1's `IRunPropertiesOptions` keys are listed with `awk '/declare type IRunStylePropertiesOptions = /,/^};/' node_modules/docx/dist/index.d.ts`.

| OOXML | option | read as |
|---|---|---|
| `w:rStyle@w:val` | `style` | string |
| `w:b`, `w:bCs`, `w:i`, `w:iCs` | `bold`, `boldComplexScript`, `italics`, `italicsComplexScript` | `isOn` |
| `w:caps`, `w:smallCaps`, `w:strike`, `w:dstrike` | `allCaps`, `smallCaps`, `strike`, `doubleStrike` | `isOn` |
| `w:emboss`, `w:imprint`, `w:noProof`, `w:snapToGrid`, `w:vanish`, `w:specVanish`, `w:rtl`, `w:oMath` | `emboss`, `imprint`, `noProof`, `snapToGrid`, `vanish`, `specVanish`, `rightToLeft`, `math` | `isOn` |
| `w:sz@w:val`, `w:szCs@w:val` | `size`, `sizeComplexScript` | number (half-points, as docx.js takes) |
| `w:color` | `color` | `colorOf`; `auto` → omit |
| `w:u` | `underline` | `{ type: w:val, color?: colorOf }` |
| `w:highlight@w:val` | `highlight` | string |
| `w:shd` | `shading` | `{ type: w:val, fill: w:fill (hex or theme, via a fill variant of colorOf), color: w:color }` |
| `w:rFonts` | `font` | see below |
| `w:spacing@w:val` | `characterSpacing` | number (twips) |
| `w:w@w:val` | `scale` | number |
| `w:kern@w:val` | `kern` | number |
| `w:position@w:val` | `position` | as docx.js writes it back; the writer-inverse test decides |
| `w:vertAlign@w:val` | `superScript` / `subScript` | `"superscript"` → `superScript: true`, `"subscript"` → `subScript: true`, `"baseline"` → omit |
| `w:effect@w:val` | `effect` | string |
| `w:em@w:val` | `emphasisMark` | `{ type }` |
| `w:lang` | `language` | `{ value: w:val, eastAsia: w:eastAsia, bidirectional: w:bidi }`, without absent keys |
| `w:bdr` | `border` | the shared border sub-codec from Change 3 |
| `w:rPrChange` | `revision` | `{ id: number, author, date, ...readRunProperties(inner w:rPr) }` |

**Fonts (`w:rFonts`).** Read `w:ascii`, `w:hAnsi`, `w:eastAsia`, `w:cs` and `w:hint`.
- A `w:*Theme` attribute (`asciiTheme`, `hAnsiTheme`, `eastAsiaTheme`, `cstheme`) resolves against `env.theme.fonts`:
  - `major*` uses `major`, and `minor*` uses `minor`;
  - `*HAnsi` and `*Ascii` use `.latin`, `*EastAsia` uses `.eastAsia`, and `*Bidi` uses `.complex`;
  - add one `resolved` note per attribute.
- If the four resolved names are equal and there is no hint, the option is a string (docx.js then writes all four). Otherwise it is the `IFontAttributesProperties` object without absent keys.

**Dropped** (docx.js has no option): `w:outline`, `w:shadow`, `w:webHidden`, `w:fitText`, `w:eastAsianLayout`, `w:cs` (the complex-script flag element, not the font attribute), `w:highlightCs`, and every `w14:*` and `w15:*` element (ligatures, text fill, glow, …).

**Ignored:** `w:rPrChange`'s `w:rsid*` attributes. Attributes are never fates; only child elements are.

**Presence-only booleans.** If `PRESENCE_ONLY.TextRun` (phase 1 `src/schema/docx-facts.ts`) contains the option and the element is off (`w:val="0"`/`"false"`/`"off"`), docx.js cannot write an explicit off. Add `dropped` with the detail `"explicit off is not expressible in docx.js"`, and omit the option.

### 3. `src/ooxml/paragraph.ts`

```ts
export type ParagraphOptions = Omit<docx.IParagraphOptions, "children" | "text" | "heading" | "numbering" | "bullet">;
export type ParagraphRead = CodecResult<ParagraphOptions> & {
  readonly numPr: { readonly numId: string; readonly level: number } | null;   // for unit 05
  readonly sectPr: XmlElement | null;                                          // for unit 04's section split
};
export function readParagraphProperties(pPr: XmlElement | null, env: CodecEnv): ParagraphRead;
export function readBorders(el: XmlElement | null, env: CodecEnv, notes: Note[]): docx.IBordersOptions | undefined;
export function readBorder(side: XmlElement, env: CodecEnv, notes: Note[]): docx.IBorderOptions;   // { style: w:val, color, size: w:sz, space: w:space }
export function readShading(shd: XmlElement, env: CodecEnv, notes: Note[]): docx.IShadingAttributesProperties;
```

| OOXML | option | read as |
|---|---|---|
| `w:pStyle@w:val` | `style` | string |
| `w:keepNext`, `w:keepLines`, `w:pageBreakBefore`, `w:widowControl`, `w:suppressLineNumbers`, `w:contextualSpacing`, `w:bidi`, `w:wordWrap`, `w:overflowPunct` | `keepNext`, `keepLines`, `pageBreakBefore`, `widowControl`, `suppressLineNumbers`, `contextualSpacing`, `bidirectional`, `wordWrap`, `overflowPunctuation` | `isOn`, with the same presence-only rule (`PRESENCE_ONLY.Paragraph`) |
| `w:jc@w:val` | `alignment` | the string verbatim. docx.js's `AlignmentType` values are the OOXML values (`JUSTIFIED` is `"both"`) |
| `w:spacing` | `spacing` | `{ before, after, line: number; lineRule: w:lineRule; beforeAutoSpacing, afterAutoSpacing: isOn of the attributes }` |
| `w:ind` | `indent` | `{ left: w:left ?? w:start, right: w:right ?? w:end, firstLine, hanging }`, numbers (twips) |
| `w:tabs` | `tabStops` | `[{ type: w:val, position: number(w:pos), leader: w:leader }]`; a `w:val="clear"` tab is kept as `type: "clear"` |
| `w:pBdr` | `border` | `readBorders` (top, bottom, left, right, between) |
| `w:shd` | `shading` | `readShading` |
| `w:outlineLvl@w:val` | `outlineLevel` | number |
| `w:framePr` | `frame` | docx.js `IFrameOptions`: attributes `w:w`, `w:h`, `w:x`, `w:y`, `w:hAnchor`, `w:vAnchor`, `w:wrap`, `w:hSpace`, `w:vSpace`, `w:dropCap`, `w:lines`. Use the x/y or alignment variant per docx.js's union |
| `w:autoSpaceDE`, `w:autoSpaceDN` | `autoSpaceEastAsianText` | `isOn(autoSpaceDE)`. If the two differ, add `dropped` |
| `w:rPr` | `run` | `readRunProperties` (the paragraph mark's run properties) |
| `w:numPr` | (not an option) | returned as `numPr: { numId: w:numId@w:val, level: Number(w:ilvl@w:val ?? 0) }` |
| `w:sectPr` | (not an option) | returned as `sectPr` |

- **Dropped:** `w:pPrChange` (docx.js cannot write tracked paragraph formatting), `w:textAlignment`, `w:suppressAutoHyphens`, `w:mirrorIndents`, `w:snapToGrid`, `w:adjustRightInd`, `w:kinsoku`, `w:topLinePunct`, `w:textDirection`, `w:divId`, and every `w14:*`.
- **Ignored:** `w:cnfStyle`, a table-style condition cache Word recomputes.

### 4. `test/support/docx-props.ts`

```ts
/** The <w:rPr> docx.js writes for a TextRun with these options, or "" when it writes none. */
export async function runPropertiesXml(options: RunOptions): Promise<string>;
/** The <w:pPr> docx.js writes for a Paragraph with these options (and one "x" run), or "". */
export async function paragraphPropertiesXml(options: ParagraphOptions): Promise<string>;
```

Build `new docx.Document({ sections: [{ children: [paragraph] }] })` with `docx.Packer.toBuffer`. Use the unit-01 fixture's unzip or `fflate`. Take the first `<w:pPr>…</w:pPr>` (or the run's first `<w:rPr>…</w:rPr>`) inside `<w:body>` with a non-greedy match, anchored at the first `<w:p>`.

### 5. `test/ooxml-run-paragraph.test.ts` (AC4)

**The writer-inverse test.** For each sample `s` in a `RUN_SAMPLES` table:
1. `x1 = await runPropertiesXml(s)`.
2. `r = readRunProperties(parseXml(x1), EMPTY_ENV)`.
3. `x2 = await runPropertiesXml(r.options)`.
4. Assert `x2 === x1` and that `r.notes` has no `dropped` entry.

Do the same with `PARAGRAPH_SAMPLES` and `paragraphPropertiesXml`.

The tables need at least **one sample per mapped row** in Changes 2 and 3, and include these:
- `bold: true`
- `bold: false` (writes `w:val="false"`, which is not presence-only)
- `size: 28`
- `color: "FF0000"`
- `underline: { type: "double", color: "00FF00" }`
- `font: "Arial"`
- `font: { ascii: "A", eastAsia: "B", cs: "C", hAnsi: "A" }`
- `superScript: true`
- `characterSpacing: 40`
- `shading: { type: "clear", fill: "EEEEEE", color: "auto" }`
- `language: { value: "en-US", eastAsia: "ja-JP" }`
- `highlight: "yellow"`
- `spacing: { before: 120, after: 240, line: 276, lineRule: "auto" }`
- `indent: { left: 720, hanging: 360 }`
- `alignment: "both"`
- `tabStops: [{ type: "right", position: 9026, leader: "dot" }]`
- `border: { bottom: { style: "single", size: 6, color: "auto", space: 1 } }`
- `keepNext: true`
- `outlineLevel: 1`
- `run: { bold: true }`

**The hand-written cases:**
- **Dropped:** `w14:ligatures` is dropped with a note.
- **Theme fonts:** `w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:cstheme="minorBidi"` with an env whose minor fonts are `{ latin: "Calibri", eastAsia: "MS Mincho", complex: "Arial" }` gives the object form and four `resolved` notes.
- **Theme colours:**
  - `w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="80"` gives `"1F3864"` and no note.
  - `w:color w:themeColor="accent1"` with accent1 `4472C4` gives `"4472C4"` and a `resolved` note.
  - `themeTint="99"` on `4472C4` gives the tinted value computed by the formula in Change 1. Assert the exact hex.
- **Explicit off:** if `PRESENCE_ONLY.Paragraph` contains `keepNext`, then `<w:keepNext w:val="0"/>` gives `dropped`. Otherwise assert `keepNext: false` maps.
- **Unknown children:** an unknown child `<w:foo/>` gives `dropped` with `element: "w:foo"`.
- **Side outputs:** `readParagraphProperties` returns `numPr` and `sectPr`, and neither appears in `options`.

## Verify

```sh
pnpm test -- test/ooxml-run-paragraph.test.ts
pnpm test
pnpm run type-check
```

## Watch out

- The writer-inverse test is the definition of "correct". When a sample fails, the codec is wrong about docx.js's representation. Do not adjust the sample to make it pass. Some options, such as `position`, accept a string but docx.js writes a number; the codec must return whatever makes `x2 === x1`.
- Fates are keyed by **child element** name. Attributes on `w:rPr`/`w:pPr` themselves (`w:rsidR`, …) are never reported.
- `src/ooxml/` imports docx only as `import type`, because the HTML bundle uses these codecs (decision 15).
