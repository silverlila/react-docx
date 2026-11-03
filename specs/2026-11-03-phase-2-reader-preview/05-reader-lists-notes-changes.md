# 05 — Reader: lists, footnotes, comments, tracked changes

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC7
- **You will see**: a Word document with bulleted and numbered lists (nested, and restarting), footnotes, margin comments and tracked insertions and deletions reads into a tree where:
  - lists are `Paragraph`s with `numbering: { reference: "list-1", level, instance }` and a `numbering.config` built from the file;
  - footnotes are inline `<Footnote>`s;
  - comments are `<Comment>` children of Document with their ranges;
  - insertions and deletions are `InsertedTextRun` and `DeletedTextRun`.

## Goal

Replace unit 04's `"read in unit 05"` placeholders for numbering, footnotes, comments and tracked changes with real mappings. After this unit, `grep -rn "read in unit 05" src` prints only the lines for drawings, VML and math, which unit 06 replaces.

## Files

- `src/read/numbering.ts`: new. `numbering.xml` → `numbering.config`, plus `numId` → `{ reference, instance }`.
- `src/ooxml/markers.ts`: new. List marker text, shared with unit 09's HTML resolver.
- `src/read/notes.ts`: new. Footnotes and comments.
- `src/read/changes.ts`: new. `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`.
- `src/read/body.ts`: use the four modules above in place of the placeholders.
- `src/read/styles.ts`: a style's `numPr` → `paragraph.numbering`.
- `src/read/document.ts`: `Comment` children; header and footer list markers; mark `word/numbering.xml`, `word/footnotes.xml` and `word/comments.xml` as consumed.
- `test/read-rich.test.ts`: new (AC7).

## Changes

### 1. Numbering (`src/read/numbering.ts`)

```ts
export type ListRef = { readonly reference: string; readonly instance: number; readonly levels: readonly docx.ILevelsOptions[] };
export type NumberingReader = {
  /** null for numId "0" or an unknown numId. Registers the reference/instance on first use (document order). */
  refOf(numId: string): ListRef | null;
  /** numbering.config: one entry per referenced abstractNum, in order of first use. */
  config(): docx.INumberingOptions["config"];
};
export function readNumberingPart(ctx: ReadContext): NumberingReader;
```

**Reading the part.**
- Parse `w:abstractNum` (by `w:abstractNumId`, levels through `readLevel`) and `w:num` (`w:numId` → `w:abstractNumId@w:val`, plus its `w:lvlOverride`s).
- `w:abstractNum`'s `w:nsid`, `w:tmpl`, `w:multiLevelType` and `w:name` give `ignored`. `w:numStyleLink` and `w:styleLink` give `dropped`.

**Ids** (decision 5):
- A `reference` is `list-${ordinals.next("abstractNum", abstractNumId)}`.
- An `instance` is `ordinals.next(\`instance:${reference}\`, numId) - 1`. The first `w:num` used for an abstractNum gets 0, which is docx.js's default.
- Only abstractNums some paragraph or style uses appear in `config()`. docx.js's own `default-bullet-numbering`, which every docx.js file contains, is unused and gives `ignored`.

**Overrides.**
- docx.js writes `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>` on **every** `w:num` it creates (verified 2026-11-03, docx 9.5.1). So a level-0 override holding only `w:startOverride w:val="1"` needs nothing more: writing the instance back reproduces it.
- Any other `w:lvlOverride` (another level, another start value, or an inline `w:lvl`) gives `dropped`, and the paragraph keeps the abstract levels.

**Open question (`00-context.md`).** Whether two `w:num`s that share an abstractNum with no override continue counting in Word. Keep the instance decision inside one function, `instanceOf(numId, abstractNumId, overrides)`, so the answer changes one line.

**Paragraphs** (in `body.ts`). A `numPr` that `refOf` resolves becomes `numbering: { reference, level, instance }`, plus `custom: true` when the source paragraph has **no** `w:pStyle`. docx.js adds `pStyle=ListParagraph` unless `style` or `custom` is set (verified, phase 1 `00-context.md`), and the source had no style. A `numPr` with `numId` `"0"`:
- maps to `numbering: false`. docx.js writes `numbering: false` as `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>` (verified 2026-11-03). That is how Word says "not a list, even if the style is".

**Styles** (in `styles.ts`). A paragraph style's `numPr` becomes `paragraph.numbering: { reference, level, instance }`, without `custom`.

**Headers and footers** (decision 2). A numbered paragraph read inside a `w:hdr`/`w:ftr` part:
- loses `numbering`;
- gains a leading `TextRun` holding the marker text from `markerText` (Change 2), using the paragraph mark's run properties (`w:pPr/w:rPr`), followed by the level's suffix: `Tab` for `"tab"` (the default), `" "` for `"space"`, nothing for `"nothing"`;
- gets the level's `style.paragraph.indent` merged in if the paragraph has no `indent` of its own;
- produces a `resolved` diagnostic.

Counters are per `(reference, instance, level)` within that one part.

### 2. Markers (`src/ooxml/markers.ts`)

```ts
export type Counters = Map<string, number[]>;   // key `${reference}:${instance}` → count per level
/** Advances the counter for (key, level), resets deeper levels, and renders lvlText:
 *  each %n (1-based) becomes level n−1's count in that level's format. */
export function markerText(levels: readonly docx.ILevelsOptions[], counters: Counters, key: string, level: number): string;
export function formatNumber(n: number, format: string): string;
```

Formats:

| Format | n=1, 2 | n=27 / n=4 |
|---|---|---|
| `decimal` | 1, 2 | |
| `decimalZero` | 01, 02 | |
| `lowerLetter` | a, b | aa (n=27) |
| `upperLetter` | A, B | AA (n=27) |
| `lowerRoman` | i, ii | iv (n=4) |
| `upperRoman` | I, II | IV (n=4) |
| `bullet` | lvlText as-is | |
| `none` | "" | |
| `ordinal` | 1st, 2nd | |

Any other format renders as decimal, and the caller gives `resolved` with the detail `"<format> shown as decimal"`. Counting starts at the level's `start` (default 1).

### 3. Footnotes and comments (`src/read/notes.ts`)

**Footnotes.**
- Read `word/footnotes.xml` (through the main part's `footnotes` relationship, falling back to that path) into `id → w:footnote`. Skip `w:type="separator"`, `"continuationSeparator"` and `"continuationNotice"`.
- In a run, `w:footnoteReference w:id="n"` splits the run (unit 04's split) and becomes `Footnote` with children `readBlocks(footnote, ctx.within("word/footnotes.xml", at))`.
- Inside the footnote's first paragraph, the run holding `w:footnoteRef` is removed and gives `ignored`. docx.js writes its own.
- The reference run's `w:rStyle="FootnoteReference"` gives `ignored`, because docx.js writes it.
- A second reference to the same id duplicates the content, with a `resolved` note `"footnote n referenced twice; content duplicated"`.
- A reference inside a header, footer or comment gives `dropped`, per phase 1's canonical rule 18.

**Comments.**
- Read `word/comments.xml` into `w:comment`s. Each becomes `Comment { id, author: w:author, initials: w:initials, date: new Date(w:date) }` with children `readBlocks(comment)`. `w:date` is optional: a comment without one has no `date` prop. Phase 1 writes a dateless Comment with no `w:date`, so this round-trips. The run holding `w:annotationRef` is removed and gives `ignored`.
- Comment ids are ordinals of first appearance: body order of `w:commentRangeStart` or `w:commentReference`, then unreferenced comments in file order. The value is `ordinals.next("comment", w:id) - 1`, so ids start at 0 as in the phase-1 tests.
- `w:commentRangeStart` and `w:commentRangeEnd` (inline) become `CommentRangeStart`/`CommentRangeEnd { id }`. `w:commentReference` (run content) becomes `CommentReference { id }`.
- Comments become Document children, after all Sections.
- `word/commentsExtended.xml`, `word/commentsIds.xml` and `word/commentsExtensible.xml` (resolved state, threading) give part-level `dropped`.

### 4. Tracked changes (`src/read/changes.ts`)

- **`w:ins` whose element children are all `w:r`.** Each run becomes `InsertedTextRun { id, author: w:author, date: w:date, ...readRunProperties(rPr).options }` with that run's content (unit 04's run walk). `id = ordinals.next("change", w:id)`.
- **`w:del` with only `w:r` children.** Each run becomes `DeletedTextRun` the same way. `w:delText` is read as a literal string, and `w:delInstrText` gives `dropped`.
- **`w:moveTo` and `w:moveFrom`.** Treated as `w:ins` and `w:del`, with a `resolved` note `"move shown as insert/delete"`. `w:moveFromRangeStart/End` and `w:moveToRangeStart/End` give `ignored`.
- **A `w:ins`/`w:del` holding anything other than runs** (a hyperlink, a field). The content is read normally, which keeps inserted content visible, and the wrapper gives `dropped`. The deleted content of such a `w:del` is dropped with it.
- **Paragraph-mark and property changes** (`w:pPr/w:rPr/w:ins|w:del`, `w:pPrChange`, `w:tblPrChange` …) are already `dropped` by the unit 02–03 codecs. Leave them.

### 5. `test/read-rich.test.ts` (AC7)

Use the fixture builder, with `numbering`, `footnotes` and `comments` XML.

- **Lists.**
  - Two abstractNums used in this order: numbered (abstractNumId 7), then bullets (abstractNumId 3). They get references `list-1` and `list-2`, and `config()` lists them in that order with their levels.
  - Two `w:num`s on abstractNum 7, the second with a level-0 `startOverride` equal to start, give instances 0 and 1.
  - `w:ilvl="1"` gives `level: 1`.
  - A paragraph without `w:pStyle` gets `custom: true`. One with `w:pStyle="ListParagraph"` gets `style: "ListParagraph"` and no `custom`.
  - A `w:lvlOverride` on level 2 gives `dropped`.
  - docx.js's unused `default-bullet-numbering` gives `ignored` when reading `renderToBuffer` output.
- **Header markers.** A numbered paragraph in `word/header1.xml` with lvlText `%1.` and suffix tab gives a leading `TextRun ["1.", Tab]`, no `numbering`, and a `resolved` diagnostic.
- **Markers.** `markerText` with lvlText `"%1.%2."` at level 1 after two level-0 items and one level-1 item gives `"2.1."`. `formatNumber` covers each row of the Change 2 table.
- **Footnotes.**
  - A reference mid-run gives `[TextRun "a", Footnote > Paragraph > TextRun "note", TextRun "b"]`, and the `w:footnoteRef` run is gone.
  - Two references to one id give the content twice and a `resolved` diagnostic.
  - A reference in a footer gives `dropped`.
- **Comments.** Comments with `w:id`s 5 and 2, appearing in body order 5 then 2, get ids 0 and 1. Their `CommentRangeStart`, `CommentRangeEnd` and `CommentReference` carry the same ids, `Comment.date` is a `Date`, and `annotationRef` is gone. A comment without `w:date` gives a Comment with no `date`.
- **Changes.**
  - `w:ins` with two runs gives two `InsertedTextRun`s with ordinal ids.
  - `w:del` with `w:delText` gives a `DeletedTextRun` whose child is the literal text.
  - `w:moveTo` gives `InsertedTextRun` plus `resolved`.
  - A `w:ins` around a hyperlink gives the hyperlink plus `dropped`.
- **Phase-1 cases.** For each phase-1 `CASES` entry that has lists, footnotes or comments (`bug-lists` and `notes-and-blocks`), `readDocx(await renderToBuffer(el))` gives the same `Footnote` and `Comment` structure that `renderToTree(el)` has, and each list paragraph the same `level`, with references renamed to `list-N`. Instance numbers are not compared: phase 1 numbers instances with one document-wide counter, and a List nested under a List of the other type takes its own reference (`NumberedList@1`) and instance, while the reader counts instances per reference. Compare instead that paragraphs sharing an instance in one tree share it in the other. Unit 07's fixed point (read, write, read) is exact over all cases.

## Verify

```sh
pnpm test -- test/read-rich.test.ts
pnpm test
pnpm run type-check
grep -rn "read in unit 05" src   # only drawing, VML and math lines remain, which unit 06 replaces
```

## Watch out

- The override rule in Change 1 must accept exactly what docx.js writes (`startOverride w:val="1"` on level 0 of every `w:num`), or no docx.js file will be a fixed point. If a docx.js upgrade changes that, the round-trip suite in unit 07 fails first.
- Ordinals must be assigned in document order, so read the body in a single pass. Numbering references used only by a style come after all body uses.
- `Comment.date` becomes a `Date` when the comment has `w:date`, and is absent otherwise. Compare with `toEqual`, which handles `Date`.
