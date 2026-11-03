# 07 — The round-trip suite and the `roundtrip` script

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC9
- **You will see**: `pnpm run roundtrip path/to/resume.docx` writes these to `.roundtrip/resume/`:
  - `roundtrip.docx`: the file read and written back;
  - `diagnostics.json`: everything kept raw, resolved or dropped;
  - `original.pdf` and `roundtrip.pdf`, rendered by LibreOffice so you can compare them side by side.

  It also prints a summary table of the diagnostics.
- **Checkpoint**:
  1. Put one or more of your own Word files in `test/fixtures/real/`, then run `pnpm run roundtrip test/fixtures/real/*.docx`.
  2. For each, open `.roundtrip/<name>/roundtrip.docx` in Word, and `original.pdf` next to `roundtrip.pdf`.
  3. Answer: does Word open the round-tripped file without a repair prompt? Do the two PDFs show the same document? Is everything listed as `dropped` in `diagnostics.json` acceptable to lose?
  4. Answer also: do two lists that Word shows as one continuing list come back continuing, or restarting? That is the open question in `00-context.md`.

## Goal

Prove the reader against the writer. Every phase-1 case written by react-docx must read back to an exact fixed point. Every Word-shaped fixture, and any real file present, must be stable after one write (decision 10). Ship the `roundtrip` script that later units extend with `Resume.tsx` (unit 08) and `preview.html` (unit 10).

## Files

- `test/fixtures/word-shaped.ts`: new. Fixture documents that use Word's idioms, built with `test/support/docx-fixture.ts`.
- `test/round-trip.test.ts`: new (AC9).
- `scripts/roundtrip.ts`: new.
- `package.json`: add `"roundtrip": "tsx scripts/roundtrip.ts"`.
- `.gitignore`: add `.roundtrip/` and `test/fixtures/real/`.
- Any reader file under `src/read/` or `src/ooxml/` that the suite proves wrong. Fixes go in this unit. List each one in the Landed line.

## Changes

### 1. `test/fixtures/word-shaped.ts`

Export `WORD_SHAPED: readonly { name: string; bytes: Uint8Array }[]`. Each entry is built with the fixture builder and written the way Word writes:
- `w:rsid*` attributes on `w:p` and `w:r`;
- a `Normal` style with `w:default="1"`, and `w:docDefaults` with `w:rFonts w:asciiTheme="minorHAnsi"`;
- a theme with minor font Calibri and accent1 `4472C4`;
- `w:proofErr`, `w:lastRenderedPageBreak` and a `_GoBack` bookmark.

The fixtures:

| name | content |
|---|---|
| `resume` | heading styles (`Heading1`, `Title`), a two-column table without borders, a bulleted list, a numbered list that restarts, an external hyperlink, a header with a PAGE field, a footer with `NUMPAGES` |
| `formatting` | runs with theme colours (with and without `w:val`), `w14:ligatures`, character spacing, highlight, a `w:rPrChange` |
| `notes` | two footnotes, a comment range over two runs, a tracked insertion and deletion |
| `sections` | two sections (portrait, then landscape), first-page header, `w:titlePg` |
| `objects` | an inline PNG, a floating PNG, a cropped PNG, a chart in `mc:AlternateContent` with a picture fallback, a `w:sdt` content control, an `m:oMath` fraction |

### 2. `test/round-trip.test.ts` (AC9)

```ts
const read = (b: Uint8Array) => readDocx(b).document;
const write = async (t: DocumentNode) => new Uint8Array(await renderToBuffer(t));
```

1. **Exact fixed point for react-docx output.** For each phase-1 `CASES` entry:
   - `t1 = read(await renderToBuffer(element))` and `t2 = read(await write(t1))`, then `expect(t2).toEqual(t1)`;
   - `docxXml(await write(t1))` equals `docxXml(await write(t2))`.
2. **Stable after one write for Word-shaped input.** For each `WORD_SHAPED` entry:
   - `t2 = read(await write(read(bytes)))` and `t3 = read(await write(t2))`, then `expect(t3).toEqual(t2)`;
   - assert that the diagnostics of the *first* read are exactly the expected list for that fixture, inlined per fixture as `{ kind, element }` pairs. This pins what is lost.
3. **Real files.** For each `test/fixtures/real/*.docx` that exists, run the same assertion as step 2. Do not inline any diagnostics; print them with `console.info`. When the folder is empty or missing, run nothing, and the test passes on its other cases. This is deliberate, because real files are private and gitignored.
4. **Write never fails.** For each fixture, `renderToBuffer(read(bytes))` must not throw. A `TreeError` here means the reader emitted something canonicalize rejects, which is a reader bug.

When one of these fails, fix the reader or a codec, not the test. If a mismatch is a docx.js normalization the reader cannot undo (like `uiPriority` in decision 10), it belongs in step 2's one-write tolerance, which already covers it.

### 3. `scripts/roundtrip.ts`

```
pnpm run roundtrip <file.docx> [more.docx …]
```

For each file:
1. `name` = the basename without extension.
2. Clear and create `.roundtrip/<name>/`.
3. `readDocx`, then write `roundtrip.docx` with `renderToBuffer`.
4. Write `diagnostics.json`, pretty-printed with 2 spaces.
5. Print a summary: counts per kind, and the top 10 `element`s for `dropped` and `raw`.
6. If `soffice` is on `PATH`, convert both the original and `roundtrip.docx` to PDF, as `original.pdf` and `roundtrip.pdf`. Use `soffice --headless --convert-to pdf --outdir <dir> <file>` with a per-run profile `-env:UserInstallation=file://<tmpdir>`, as folio's `packages/eval/render/soffice.ts` does, so that parallel runs do not collide. Copy the original to `<dir>/original.docx` first, so the PDF gets that name. If `soffice` is missing, print one line saying so and continue.
7. Exit 1 if `readDocx` or `renderToBuffer` throws; otherwise exit 0.

Units 08 and 10 add `Resume.tsx`/`assets/` and `preview.html` to this script.

## Verify

```sh
pnpm test -- test/round-trip.test.ts
pnpm test
pnpm run type-check
pnpm run examples && pnpm run roundtrip examples/resume.docx
ls .roundtrip/resume/   # roundtrip.docx diagnostics.json (and the PDFs when soffice is installed: it is, at /opt/homebrew/bin/soffice)
```

## Watch out

- Expect this unit to find reader bugs. That is its job. Keep each fix in the module that owns the rule: codec fates in `src/ooxml/`, structure in `src/read/`. Never patch a tree after `canonicalize` to make equality pass.
- `toEqual` treats `undefined` keys as absent, which matches canonical props.
- Do not compare `t1` with `renderToTree(element)`. Reading adds docx.js's default styles and renames list references, and the fixed point is the contract (decision 10).
