# 08 — `printJsx` and `@react-docx/core/codegen`

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC11
- **You will see**:
  - `pnpm run roundtrip examples/resume.docx` now also writes `.roundtrip/resume/Resume.tsx` and `assets/`.
  - `Resume.tsx` is readable JSX: `<Document styles={styles} numbering={numbering}><Section …><Paragraph style="Heading1"><TextRun bold>…`. Running it through `renderToBuffer` writes the same document.

## Goal

Turn a canonical tree into a `.tsx` module that renders that same tree (decision 12), and ship it as the `/codegen` subpath. This is what makes "design it in Word, edit it as a React template" work.

## Files

- `src/codegen/print.ts`: new. The printer.
- `src/codegen/index.ts`: new. The subpath's exports.
- `package.json`: `exports["./codegen"]`.
- `tsup.config.ts`: the `codegen` entry.
- `vitest.config.ts`: `resolve.alias` `{ "@react-docx/core": <abs path to src/index.ts> }`, so generated modules import the source.
- `scripts/roundtrip.ts`: also write `<PascalName>.tsx` and `assets/`.
- `.gitignore`: add `test/.generated/`.
- `test/codegen.test.ts`: new (AC11).

## Changes

### 1. API

```ts
export type Asset = { readonly path: `assets/${string}`; readonly bytes: Uint8Array };
export type GeneratedModule = { readonly source: string; readonly assets: readonly Asset[] };
export type PrintOptions = { readonly componentName?: string /* default "DocumentComponent" */; readonly importFrom?: string /* default "@react-docx/core" */ };
export function printJsx(document: DocumentNode, options?: PrintOptions): GeneratedModule;
```

`src/codegen/` has **no runtime imports** outside its own files, apart from type-only imports from `src/schema/`. It is pure string building.

### 2. Module shape

```tsx
import { readFileSync } from "node:fs";                         // only when there are assets
import { PageNumber } from "docx";                              // only when a PageNumber node exists
import { Document, Section, Paragraph, TextRun } from "@react-docx/core";   // only the kinds used, sorted

const styles = { … };                                           // Document.props.styles, when present
const numbering = { … };                                        // Document.props.numbering, when present

export function Resume() {
  return (
    <Document title="Resume" styles={styles} numbering={numbering}>
      …
    </Document>
  );
}
export default Resume;
```

### 3. Printing rules

- **Elements.** Every canonical node prints as `<Kind {props}>{children}</Kind>`. With no children it is self-closing. The kind name is the component name; phase 1 exports one component per kind.
- **Props.** Props print in the tree's key order, so output is deterministic because the reader is. Skip `undefined` values.
  - A top-level `true` boolean prints as a bare attribute (`bold`).
  - Strings print as `name="…"` when they contain no `"`, `\` or newline, and as `name={"…"}` (via `JSON.stringify`) otherwise.
  - Everything else prints as `name={<value>}`.
- **Values.** Numbers and booleans print as literals. Strings use `JSON.stringify`. Arrays and objects print as literals with keys unquoted when they are identifiers, and quoted otherwise. A `Date` prints as `new Date("<toISOString()>")`. A `Uint8Array` becomes an asset (below). Nesting is indented by 2 spaces. An object or array literal that would exceed 100 columns breaks onto lines.
- **Strings in children.** A string prints as JSX text only when it has no leading or trailing whitespace and no `{`, `}`, `<`, `>`, `&` or newline. Otherwise it prints as `{"…"}`.
- **`PageNumber`.** Prints as `{PageNumber.<KEY>}`, where KEY is the `docx.PageNumber` key whose value is `field`. `"SECTION"` maps to `CURRENT_SECTION`.
- **Literal sentinel text.** A canonical run never holds a literal string equal to a `PAGE_NUMBER_VALUES` member, or `""`, as a child. Phase 1 keeps such a literal in the `text` prop of a run of its own; that is what keeps canonicalize idempotent, and `canon` in `test/canonical.test.ts` checks it on every input. It prints as an ordinary `text` prop, which is always literal (rule 4), so no case is excluded from the identity test.
- **`RawXml`.** Prints as `<RawXml xml={\`…\`} />`, a template literal with `\`, `` ` `` and `${` escaped.
- **Assets.**
  - Each `ImageRun` `data` (and `fallback.data`) becomes `assets/image<N>.<ext>`, numbered in document order. The extension comes from `type` (`jpg` → `.jpg`, `svg` → `.svg`).
  - It prints as `data={readFileSync(new URL("./assets/image1.png", import.meta.url))}`.
  - Identical bytes reuse one asset.
- **Hoisting.** `Document.props.styles` and `Document.props.numbering` become `const styles` and `const numbering` and are referenced by name. Other Document props stay inline.
- **Header and Footer.** `type="default"` is printed even though it is the default, because canonical props have it explicitly.

### 4. Subpath

- `exports["./codegen"]`: `{ types: "./dist/codegen.d.ts", import: "./dist/codegen.mjs", require: "./dist/codegen.js" }`.
- tsup entry `codegen: "src/codegen/index.ts"`.
- `src/codegen/index.ts` exports `printJsx` and the types `Asset`, `GeneratedModule` and `PrintOptions`.

### 5. `scripts/roundtrip.ts`

After writing `roundtrip.docx`:
- `componentName` = PascalCase of the file's basename (`my-resume` → `MyResume`), prefixed with `Doc` if it starts with a digit;
- write `<componentName>.tsx` and every asset under `.roundtrip/<name>/`.

### 6. `test/codegen.test.ts` (AC11)

**Identity.** For each tree from unit 07's fixtures (the phase-1 `CASES` read back, plus `WORD_SHAPED`):
1. `printJsx(tree, { componentName: "Doc" })`.
2. Write `source` and `assets` to `test/.generated/<case>/`.
3. `const mod = await import(pathToFileURL(<file>).href)`.
4. `expect(renderToTree(React.createElement(mod.default))).toEqual(tree)`.

vitest's transform handles the `.tsx`. Its `resolve.alias` maps `@react-docx/core` to `src/index.ts`, and `docx` resolves normally. `readFileSync` returns a `Buffer`, which canonicalize turns into a plain `Uint8Array` (phase 1 rule 11), so `toEqual` holds.

**Hand-written cases:**
- A string `" a "` prints as `{" a "}`.
- `bold: true` prints as `bold`.
- A `Date` prints as `new Date("2026-01-01T00:00:00.000Z")`.
- RawXml containing a backtick and `${x}` prints escaped and round trips.
- Two ImageRuns with the same bytes give one asset.
- `<TextRun text="CURRENT">x</TextRun>` (the `text` prop is literal; a "CURRENT" string child would be `PageNumber.CURRENT` itself) canonicalizes to two TextRuns: `{ text: "CURRENT" }` with no children, then one with child `"x"`. The first prints as `<TextRun text="CURRENT" />`, and re-rendered it is the literal text, not a PageNumber.
- The import list contains only the kinds used, sorted, and imports `PageNumber` only when used.

## Verify

```sh
pnpm test -- test/codegen.test.ts
pnpm test
pnpm run type-check
pnpm run build && ls dist/codegen.mjs
pnpm run roundtrip examples/resume.docx && ls .roundtrip/resume/   # Resume.tsx present
```

## Watch out

- Do not add a formatter dependency such as prettier. The printer's own indentation rules are the format, and they keep the subpath free of runtime dependencies.
- vitest caches imported modules by URL. Write each case to its own folder, and use a fresh folder per run (clear `test/.generated/` in `beforeAll`).
- The generated file imports `docx` only for `PageNumber`. A user's project already has docx, because it is a peer dependency.
