# 10 — `DocxPreview`, `@react-docx/core/html`, bundle isolation

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC1, AC2, AC10, AC13, AC14
- **You will see**:
  - `<DocxPreview document={tree} />` renders a Word document in the browser as page-width sheets with its fonts, spacing, lists, tables and images.
  - `pnpm run preview file.docx` and `pnpm run preview Resume.tsx` write a standalone HTML file you can open.
  - `pnpm run roundtrip` now writes `preview.html` too.
  - `pnpm run check:bundles` proves the browser bundles contain no docx.js.
- **Skills**: `component-design`
- **Checkpoint**:
  1. Run `pnpm run roundtrip test/fixtures/real/<your file>.docx` (or `examples/resume.docx`), then open `.roundtrip/<name>/preview.html` next to `.roundtrip/<name>/original.pdf`.
  2. Run `pnpm run preview .roundtrip/<name>/<Name>.tsx` and open its output. This is the authored-JSX path.
  3. Answer: does the preview read as the same document (fonts, sizes, spacing, list markers, tables, images, header and footer)? Is the authored-JSX preview identical to the `.docx` preview?
  4. Note what Word shows as the body font for a docx.js document with no styles (`pnpm run examples`, then open `examples/basic.docx`). Unit 09's `FALLBACK_RUN` assumes Times New Roman 10pt.

## Goal

Draw unit 09's resolved data as React DOM, and ship `/html`. That is the last subpath, which completes the package's public surface (AC2). Then prove bundle isolation (requirement 8), and wire the preview into the scripts.

## Files

- `src/html/preview.tsx`: new. `DocxPreview`.
- `src/html/index.ts`: new. The subpath's exports.
- `package.json`:
  - `exports["./html"]`;
  - devDependency `"react-dom": "^18.2.0"` (installs 18.3.1);
  - scripts `"preview": "tsx scripts/preview.tsx"` and `"check:bundles": "pnpm run build && node scripts/check-bundles.mjs"`.
- `tsup.config.ts`: the `html` entry.
- `scripts/preview.tsx`: new.
- `scripts/check-bundles.mjs`: new (AC14).
- `scripts/roundtrip.ts`: also write `preview.html`.
- `.gitignore`: add `.preview/`.
- `test/html-preview.test.tsx`: new (AC13).

## Changes

### 1. `DocxPreview` (`src/html/preview.tsx`)

```tsx
export type DocxPreviewProps = { readonly document: DocumentNode } & Omit<React.ComponentPropsWithoutRef<"div">, "children">;
export const DocxPreview = React.forwardRef<HTMLDivElement, DocxPreviewProps>(function DocxPreview({ document, ...rest }, ref) {
  const sections = React.useMemo(() => resolveDocument(document), [document]);
  // <div ref={ref} data-docx-preview {...rest}> one sheet per section </div>
});
```

All styles are inline, from unit 09's `css.ts`. There is no stylesheet and no class names, so the component works in any app without CSS setup.

**Sheet.** `<div data-docx-section data-docx-path=…>` with:
- `width: <widthPt>pt`;
- `padding: <top>pt <right>pt <bottom>pt <left>pt`;
- `boxSizing: "border-box"`, `background: "#fff"`, `color: "#000"`, `margin: "0 auto 24pt"`.

There is no fixed height and no pagination (decision 13). Header blocks come first, then body blocks, then footnotes (a short rule and the notes, numbered), then footer blocks.

**Paragraph.** `<p data-docx-path=… style={paragraphStyle(format)}>`.
- An empty paragraph gets a `<br>`, so it keeps its line height.
- The marker is a `<span data-docx-marker style={runStyle(marker.run)}>{text}</span>`, followed by:
  - for `suffix: "tab"`, an inline-block spacer whose width puts the text at the hanging indent: `max(0, -firstLinePt)` pt, with a minimum of 6pt;
  - for `space`, a space.
- **Inlines:**
  - `text` → `<span style={runStyle}>`; `tab` → `<span style={{ display: "inline-block", width: "36pt" }} />`, since Word's default tab is 0.5in;
  - `lineBreak` → `<br>`; `pageBreak` → `<hr data-docx-page-break>`; `columnBreak` → `<br data-docx-column-break>`;
  - `link` → `<a href>`; `anchor` → `<span id>`; `footnoteRef` → `<sup>`;
  - `image` → `<img src width height alt>`, with `style={{ verticalAlign: "bottom" }}`; floating images are drawn inline and carry `data-docx-floating`;
  - `field` → `<span data-docx-field>{placeholder}</span>`; `raw` → `<span data-docx-raw={element} />`.

**Table.** `<table style={{ borderCollapse: "collapse", width }}>` with `<colgroup><col style={{ width }}/>…</colgroup>`, then rows and `<td colSpan rowSpan style>`. Header rows go in `<thead>`.

**Textbox.** A bordered `<div>` with the given size. **Raw block.** `<div data-docx-raw={element} />`.

### 2. `src/html/index.ts` and packaging

```ts
export { DocxPreview, type DocxPreviewProps } from "./preview";
export { resolveDocument, type ResolvedSection, type ResolvedBlock, type ResolvedInline } from "./resolve";
export { renderToTree } from "../tree/render";
export type { DocumentNode } from "../schema/elements";
```

- `exports["./html"]`: `{ types: "./dist/html.d.ts", import: "./dist/html.mjs", require: "./dist/html.js" }`.
- tsup entries are now `{ index, reader, codegen, html }`.
- Add `"react-dom"` to tsup's `external` defensively; nothing in `src/` imports it.

### 3. `scripts/check-bundles.mjs` (AC14)

For each entry in `dist/` (`index`, `reader`, `codegen`, `html`) and each format (`.mjs` follows `import … from "x"` and `export … from "x"`; `.js` follows `require("x")`):
- follow relative specifiers (`./chunk-*.mjs`) transitively;
- collect the bare package specifiers.

Assert each entry's set:

| Entry | Must not include | May include |
|---|---|---|
| `html` | `docx`, `fflate`, `xml-js` | `htmlparser2` and `domhandler` (decision 15) |
| `reader` | `docx`, `xml-js` | |
| `codegen` | anything except `react` | `react` (type-only should vanish; if it appears, fail and say so) |
| `index` | `fflate`, `htmlparser2`, `domhandler` | |

Print each entry's set, and exit 1 with the offending chain on failure.

### 4. `scripts/preview.tsx`

```
pnpm run preview <file.docx | module.tsx> [out.html]
```

- `.docx` → `readDocx(readFileSync(file)).document`.
- `.tsx`/`.jsx`/`.ts` → `await import(pathToFileURL(file).href)`, whose `default` is a component or element → `renderToTree(React.isValidElement(d) ? d : React.createElement(d))`.
- Write `<!doctype html><html><head><meta charset="utf-8"><title>{name}</title></head><body style="margin:0;background:#e8e8e8;padding:24pt 0">{renderToStaticMarkup(<DocxPreview document={tree} />)}</body></html>` to `out.html`, or to `.preview/<name>.html` by default.
- Print the path.

**Imports in a generated module.** A generated `Resume.tsx` (unit 08) imports `@react-docx/core`. Running it from `.roundtrip/` resolves that name through the package's self-reference, which Node supports for a package with `exports`, but only from inside the package directory. `.roundtrip/` is inside it, so it works.

Verify this in the unit: run `pnpm run build && pnpm run preview .roundtrip/resume/Resume.tsx`. If self-reference does not resolve under `tsx`, register an alias in the script (`module.register` with a resolve hook mapping `@react-docx/core` → `dist/index.mjs`, as in phase 1 unit 02's hooks). Record which one was needed.

### 5. `scripts/roundtrip.ts`

After `Resume.tsx`, write `preview.html` from the **read** tree, with the same HTML wrapper as `scripts/preview.tsx`. Share that wrapper through a function `previewHtml(tree, title)` exported from `scripts/preview.tsx`.

### 6. `test/html-preview.test.tsx` (AC13)

Render with `react-dom/server`'s `renderToStaticMarkup`. Use:
- a phase-1 `CASES` read tree;
- `WORD_SHAPED.resume` read;
- an authored tree from `renderToTree`.

Assert:
- Every `ResolvedBlock.path` appears as a `data-docx-path="…"` (the path joined with `.`).
- Exactly one `data-docx-section` per Section.
- The header's first block appears before the body's first block.
- `<img src="data:image/png;base64,` is present for the image case.
- A merged table renders `rowSpan="3"`.
- Marker text `1.` appears in a `data-docx-marker`.
- `<hr data-docx-page-break` appears for a page break.
- `DocxPreview` forwards `className` and `ref`. For the ref, use `react-dom/client` in a jsdom-free way: render to a string and check the `className`. For the ref, assert that the component is a `forwardRef` object (`$$typeof`).

## Verify

```sh
pnpm install
pnpm test
pnpm run type-check
pnpm run build && ls dist/{index,reader,codegen,html}.{js,mjs,d.ts}
pnpm run check:bundles
pnpm run test:react
pnpm run examples
pnpm run roundtrip examples/resume.docx && ls .roundtrip/resume/   # roundtrip.docx diagnostics.json Resume.tsx assets/ preview.html
pnpm run preview .roundtrip/resume/Resume.tsx
```

This is the last unit of phase 2, so `00-context.md`'s Verification block must pass in full.

## Watch out

- `DocxPreview` takes only `document`. Rendering JSX children inside it would run a second reconciler inside a React DOM render, which is unverified under React 19 (design, Rejected). Callers write `useMemo(() => renderToTree(el), [el])`.
- Do not add `react-dom` to `peerDependencies`. The component only needs `react`; `react-dom` is a devDependency for the scripts and tests.
- If `check:bundles` shows `docx` reaching `html`, the leak is a runtime `import … from "docx"` somewhere under `src/schema`, `src/tree`, `src/ooxml` or `src/html`. Find it with `grep -rn 'from "docx"' src/schema src/tree src/ooxml src/html src/read src/codegen | grep -v "import type"`.
