# 06 — Reader: images, text boxes, math, alternate content

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC8
- **You will see**:
  - A resume photo, inline or floating, reads into `<ImageRun type="png" data={…} transformation={{ width, height }} floating={…} />` with its bytes.
  - A cropped photo comes back uncropped, with a `dropped` note.
  - A VML text box becomes `<Textbox>`, simple equations become `<Math><MathRun>…`, and charts or shapes with a picture fallback become that picture.

## Goal

Replace the last `"read in unit 05"` placeholders, which cover `w:drawing`, `w:pict`/`w:object` and `m:oMath`. Make `mc:AlternateContent` prefer content the tree can hold.

After this unit, `grep -rn "read in unit 05" src` prints nothing.

## Files

- `src/read/images.ts`: new. `w:drawing` (DrawingML) and VML `v:imagedata` → `ImageRun`.
- `src/read/objects.ts`: new. VML text boxes → `Textbox`, `mc:AlternateContent` choice, `w:object`.
- `src/read/math.ts`: new. `m:oMath` → `Math`/`MathRun`, or RawXml.
- `src/read/body.ts`: dispatch to the modules above.
- `test/support/docx-props.ts`: add `imageRunXml(options)`, which returns the `w:drawing` docx.js writes.
- `test/read-objects.test.ts`: new (AC8).

## Changes

### 1. DrawingML images (`src/read/images.ts`)

```ts
/** w:drawing → ImageRun author node, or null (with a diagnostic) when it is not a supported picture. */
export function readDrawing(drawing: XmlElement, runProps: RunOptions, ctx: ReadContext): AuthorNode | null;
```

A `w:drawing` inside a run splits the run (unit 04's split) and becomes `ImageRun`. The run's own properties are not carried to the image.

- **Container.** `wp:inline` or `wp:anchor`. Graphic: `a:graphic/a:graphicData`.
  - If `graphicData@uri` is the picture URI (`http://schemas.openxmlformats.org/drawingml/2006/picture`) → `pic:pic`.
  - Otherwise (chart, SmartArt `dgm`, `wps` shape, `wpg` group) → `dropped` with detail `"<uri> is not a picture"`. When it sits inside an `mc:AlternateContent`, Change 3 picks the fallback first.
- **Bytes.**
  - `pic:blipFill/a:blip@r:embed` → `pkg.relsOf(ctx.part).get(id).target` → `pkg.media(target)`. Missing bytes give `dropped`.
  - **Type by extension:** `.png` → `"png"`, `.jpg`/`.jpeg` → `"jpg"`, `.gif` → `"gif"`, `.bmp` → `"bmp"`. `.emf`, `.wmf`, `.tif` and `.tiff` give `dropped` (docx.js cannot write them).
  - **SVG:** `a:blip/a:extLst/a:ext/asvg:svgBlip@r:embed` gives `type: "svg"`, `data` = the SVG bytes, `fallback: { type: <raster type>, data: <raster bytes> }`.
- **`transformation`:**
  - `wp:extent@cx`/`@cy` → `width`/`height` = `Math.round(EMU / 9525)` (decision 11).
  - `pic:spPr/a:xfrm@rot` → `rotation` = `rot / 60000`.
  - `@flipH`/`@flipV` → `flip: { horizontal, vertical }`, with only the true keys.
- **`altText`.** `wp:docPr@descr`/`@title`/`@name` → `{ description, title, name }`, without absent keys.
- **`floating`** (anchor only):
  - `wp:positionH@relativeFrom` → `horizontalPosition.relative`, with child `wp:posOffset` → `offset` (EMU, as docx.js takes it) or `wp:align` → `align`.
  - `wp:positionV` maps the same way to `verticalPosition`.
  - Anchor attributes: `allowOverlap`, `locked` → `lockAnchor`, `behindDoc` → `behindDocument`, `layoutInCell` (all `"1"`/`"0"`), `relativeHeight` → `zIndex`, and `distT`/`distB`/`distL`/`distR` → `margins: { top, bottom, left, right }`.
  - Wrap: `wp:wrapNone` → `{ type: 0 }`, `wp:wrapSquare` → `{ type: 1, side: @wrapText }`, `wp:wrapTight` → `{ type: 2, side }`, `wp:wrapTopAndBottom` → `{ type: 3 }`, using docx.js's `TextWrappingType` numeric values. Read `TextWrappingType` in `node_modules/docx/dist/index.d.ts` and use its literal values.
  - `wp:wrapThrough` and `wp:effectExtent` give `dropped`. `wp:simplePos` with `simplePos="1"` gives `dropped`.
- **`outline`.** `pic:spPr/a:ln` holding `a:solidFill/a:srgbClr` becomes `outline: { type: "solidFill", solidFillType: "rgb", value: <hex> }`. That is docx.js's `OutlineOptions`; read its type and let the writer-inverse test confirm. Any other `a:ln` gives `dropped`.
- **Dropped with a note:**
  - `a:srcRect` (crop), with detail `"crop is not expressible; image kept uncropped"`;
  - `a:effectLst`;
  - `pic:spPr/a:prstGeom` with a value other than `rect`;
  - `a:alphaModFix` and other blip effects;
  - `wp14:*` attributes and elements.

### 2. VML (`src/read/objects.ts`)

- **`w:pict` with `v:shape` holding `v:imagedata@r:id`** → `ImageRun`. Bytes and type come as in Change 1. Size comes from the shape's `style` attribute (`width:72pt;height:36pt`): pt × 96 / 72, rounded to px, with a `resolved` note `"VML image converted to DrawingML"`.
- **`w:pict` with `v:shape` holding `v:textbox/w:txbxContent`** → `Textbox`:
  - `style` comes from the `v:shape@style` declarations that `VmlShapeStyle` has (`width`, `height`, `position`, `margin-left` → `marginLeft`, `mso-position-horizontal` → `positionHorizontal`, …; map the hyphenated CSS names to the camelCase keys of `VmlShapeStyle` in `node_modules/docx/dist/index.d.ts`). Others give `dropped`.
  - Children are `readBlocks(txbxContent)`. canonicalize gives a Textbox with no children one empty Paragraph (phase 1: `w:txbxContent` needs a block), so an empty text box reads as a Textbox holding one empty Paragraph.
  - docx.js writes a Textbox as its own `w:p` (verified, phase 1 unit 06). So when the `w:pict` is the only non-empty content of its paragraph, that paragraph **becomes** the Textbox: the paragraph's props go into the Textbox options (`ITextboxOptions` extends paragraph options), and a `w:pPr/w:pStyle` gives `dropped`, because Textbox omits `style`. Otherwise it gives `dropped`, `"text box sharing a paragraph with other content"`.
  - A text box in a header, footer or table cell gives `dropped`: Textbox is Section-body only.
- **`w:pict` or `w:object` with anything else** (OLE `o:OLEObject`, VML shapes without text) → the generic fallback. These carry `r:id`, so they almost always end `dropped`.

### 3. `mc:AlternateContent`

In any slot, try `mc:Choice`'s content first:
- if every element in it maps to a kind other than RawXml (for example a DrawingML picture), use it;
- otherwise read `mc:Fallback`'s content (often a `w:pict` VML picture, or a picture rendering of a chart).

Report `resolved` with detail `"alternate content: used Choice"` or `"used Fallback"`. If neither yields content, give `dropped`. This replaces unit 04's wrapper handling for `mc:AlternateContent` only.

### 4. Math (`src/read/math.ts`)

- An inline `m:oMath` whose element descendants are only `m:r`, `m:t` and `m:rPr`/`w:rPr` becomes `Math` with one `MathRun` per `m:r`, holding the `m:t` text. `m:rPr`/`w:rPr` give `dropped`, because `MathRun` takes no properties.
- Any other `m:oMath`, and any `m:oMathPara`, becomes inline RawXml via the generic fallback. OMML carries no relationships, so it is lossless.

### 5. `test/read-objects.test.ts` (AC8)

**The writer-inverse test for images.** For samples built with docx.js `ImageRun` options, `imageRunXml(sample)` → `readDrawing` → `imageRunXml(read)` must give equal XML. The `r:embed` and `wp:docPr@id` values are stable (verified, phase 1 `00-context.md`). The samples:
- inline: `{ type: "png", data: PNG_1PX, transformation: { width: 120, height: 80 } }`;
- with `rotation: 90` and `flip: { horizontal: true }`;
- with `altText: { name: "photo", description: "Ada", title: "t" }`;
- floating: `{ horizontalPosition: { relative: "page", offset: 914400 }, verticalPosition: { relative: "paragraph", align: "top" }, wrap: { type: <square>, side: "bothSides" }, margins: { top: 0, bottom: 0, left: 114300, right: 114300 }, behindDocument: false, allowOverlap: true }`;
- svg with a png fallback.

**The hand-written cases** (fixture XML):
- A cropped picture (`a:srcRect l="10000"`) gives an ImageRun plus `dropped` `"crop …"`.
- An `.emf` blip gives `dropped`.
- A chart `graphicData` inside `mc:AlternateContent` with a `w:pict` image fallback gives an ImageRun plus `resolved` `"used Fallback"`.
- A chart without a fallback gives `dropped`.
- A VML image gives an ImageRun with px from pt.
- A VML text box alone in its paragraph gives `Textbox` with children; one sharing its paragraph gives `dropped`.
- `m:oMath` with two `m:r` gives `Math > [MathRun "x", MathRun "+1"]`.
- `m:oMath` with `m:f` (a fraction) gives inline RawXml plus `raw`.
- The phase-1 `image` and `bug-math-text` cases, read from `renderToBuffer`, give the same `ImageRun` props and data, and the same `Math` structure, as `renderToTree`.

## Verify

```sh
pnpm test -- test/read-objects.test.ts
pnpm test
pnpm run type-check
grep -rn "read in unit 05" src   # prints nothing
```

## Watch out

- docx.js's floating `offset` is in EMU, but `transformation` is in pixels. Do not convert offsets to pixels.
- Pixel rounding (`Math.round(EMU / 9525)`) loses up to half a pixel. docx.js writes `px × 9525`, so the second read is stable. That is exactly the "stable after one write" case in decision 10.
- The `r:embed` check in the generic fallback means a picture can never become RawXml. A picture that `readDrawing` cannot map is `dropped`, never raw.
