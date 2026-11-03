# 07 — The remaining inline and run elements, plus the docx.js coverage test

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC14, AC15
- **You will see**:
  - Tracked insertions and deletions, column breaks, simple and mail-merge fields, `SEQ` and `PAGEREF` fields, check boxes, positional tabs and date fields can all be written as JSX.
  - `test/coverage.test.ts` lists every docx.js content class and says, for each, whether it is a react-docx element or why not.

## Goal

Add the last 17 kinds from requirement 11. Then add a coverage test that reads docx.js's own type declarations, so a future docx.js release that adds a content class fails the suite until someone maps it or records why not.

## Files

- `src/schema/elements.ts`: 17 rows, the grammar additions, and the `NOT_MAPPED` table.
- `src/tree/canonical.ts`: rules 1, 4 and 6 now apply to all three run kinds (Change 2).
- `src/write/build.ts`: 17 builders. The TextRun builder is generalized to the three run kinds.
- `src/components.ts`, `src/types.ts`, `src/index.ts`: the components and prop types.
- `test/inline-elements.test.tsx`: new (AC14).
- `test/coverage.test.ts`: new (AC15).
- `test/canonical.test.ts`: tests for the generalized rules.

## Changes

### 1. Kinds

**INLINE kinds.** Each is added to `INLINE`, so it is legal in Paragraph, hyperlinks and Bookmark.

| Kind | docx | children | text | ooxml | props |
|---|---|---|---|---|---|
| InsertedTextRun | `"InsertedTextRun"` | `RUN_CONTENT` | yes | `w:ins` | `Omit<ConstructorParameters<typeof docx.InsertedTextRun>[0], "children" \| "text">` |
| DeletedTextRun | `"DeletedTextRun"` | `RUN_CONTENT` | yes | `w:del` | `Omit<ConstructorParameters<typeof docx.DeletedTextRun>[0], "children" \| "text">` |
| ColumnBreak | `"ColumnBreak"` | `[]` | no | `w:br` | `{}` |
| SimpleField | `"SimpleField"` | `[]` | no | `w:fldSimple` | `{ readonly instruction: string; readonly cachedValue?: string }` |
| SimpleMailMergeField | `"SimpleMailMergeField"` | `[]` | no | `w:fldSimple` | `{ readonly fieldName: string }` |
| SequentialIdentifier | `"SequentialIdentifier"` | `[]` | no | `w:instrText` | `{ readonly identifier: string }` |
| PageReference | `"PageReference"` | `[]` | no | `w:instrText` | `{ readonly bookmarkId: string } & docx.IPageReferenceOptions` |
| CheckBox | `"CheckBox"` | `[]` | no | `w:sdt` | `docx.ICheckboxSymbolOptions` |

**RUN_CONTENT kinds.** Each is added to `RUN_CONTENT`, so it is legal in the three run kinds. Rule 5 wraps it when it stands directly in a Paragraph.

| Kind | docx | ooxml | props |
|---|---|---|---|
| PositionalTab | `"PositionalTab"` | `w:ptab` | `docx.PositionalTabOptions` (`alignment`, `relativeTo`, `leader`, all required) |
| CarriageReturn | `"CarriageReturn"` | `w:cr` | `{}` |
| SoftHyphen | `"SoftHyphen"` | `w:softHyphen` | `{}` |
| NoBreakHyphen | `"NoBreakHyphen"` | `w:noBreakHyphen` | `{}` |
| DayShort, DayLong, MonthShort, MonthLong, YearShort, YearLong | same names | `w:dayShort`, … | `{}` |

These all have `children: []` and `text: false`.

**Verified output.** On 2026-11-03, against docx 9.5.1:
- `new InsertedTextRun({ id: 1, author: "A", date, children: ["ins"] })` → `<w:ins …><w:r><w:t>ins</w:t></w:r></w:ins>`.
- `DeletedTextRun` with `children: ["del"]` → `<w:del …><w:r><w:delText>del</w:delText></w:r></w:del>`.
- `ColumnBreak` → `<w:r><w:br w:type="column"/></w:r>`.
- `SimpleField("AUTHOR", "Ada")` → `<w:fldSimple w:instr="AUTHOR">…Ada…`.
- `SimpleMailMergeField("Name")` → `w:instr=" MERGEFIELD Name "`.
- `SequentialIdentifier("Figure")` → `SEQ Figure`.
- `PageReference("bm", { hyperlink: true })` → `PAGEREF bm \h`.
- `CheckBox({ checked: true })` → a `w14:checkbox` sdt with `☒`.
- Each run-content class inside `new TextRun({ children: [...] })` → its element inside one `<w:r>`.

The `date` of the tracked-change runs is a string (docx.js's `IChangedAttributesProperties`), so it stays JSON.

### 2. Generalized canonical rules

"Run kind" now means `TextRun`, `InsertedTextRun` or `DeletedTextRun`:

- **Rule 1.** Sentinel strings become `PageNumber` in all three run kinds.
- **Rule 4.** A `text` prop becomes the leading child in all three.
- **Rule 6.** Breaks split all three, and a split keeps the same kind and props for both halves.

Write each as one function parameterized by kind. Do not copy the rule three times.

### 3. Builders

- The three run kinds share one `buildRun(Ctor, node, ctx)` that applies the unit-04 sentinel escape.
- Each simple kind is one constructor call:
  - `new docx.ColumnBreak()`
  - `new docx.SimpleField(instruction, cachedValue)`
  - `new docx.SimpleMailMergeField(fieldName)`
  - `new docx.SequentialIdentifier(identifier)`
  - `new docx.PageReference(bookmarkId, rest)`
  - `new docx.CheckBox(props)`
  - `new docx.PositionalTab(props)`
  - `new docx.CarriageReturn()`, `new docx.SoftHyphen()`, `new docx.NoBreakHyphen()`, `new docx.DayShort()`, and so on for the date fields.
- `PageReference` is not in docx.js's `ParagraphChild` union, but it extends `Run` and docx.js writes it as a paragraph child (verified above). Route it through the same single cast helper as RawXml, with a comment.

### 4. `NOT_MAPPED`

These are exact keys, and each needs a one-line reason. The test fails on any key whose reason is empty.

| docx.js name | Reason |
|---|---|
| `Comments` | the comments part container; built from `<Comment>` children of Document |
| `AnnotationReference` | written by docx.js inside comment parts |
| `FootnoteReferenceElement` | written by docx.js inside footnote parts |
| `Separator`, `ContinuationSeparator` | footnote separators |
| `EndnoteReference` | docx.js has no endnotes part (out of scope) |
| `LastRenderedPageBreak` | a layout cache Word writes and recomputes |
| `PageNumberElement` | written by docx.js for `PageNumber` field values |
| `MathFraction`, `MathSum`, `MathIntegral`, `MathSuperScript`, `MathSubScript`, `MathSubSuperScript`, `MathRadical`, `MathFunction`, `MathRoundBrackets`, `MathCurlyBrackets`, `MathAngledBrackets`, `MathSquareBrackets` | named slots need a slot-component design (out of scope); author as `<RawXml>` OMML meanwhile |

### 5. `test/coverage.test.ts` (AC15)

Read `node_modules/docx/dist/index.d.ts` as text with `readFileSync`, resolving the path with `require.resolve("docx")` plus `../index.d.ts`. Then:

1. Build the alias map from the `export { X_2 as Y }` lines. For example, `Math_2` becomes `Math`, and `Comment_2` becomes `Comment`.
2. Build the content-class set as the union of:
   - (a) the names in `export declare type ParagraphChild = …;`
   - (b) every `export declare class (\w+) extends FileChild`
   - (c) the names inside `IRunOptions`'s `readonly children?: readonly ( … )[]` (found from the `export declare type IRunOptions = {` line), excluding `string` and the `typeof PageNumber…` term
   - (d) the names in `export declare type MathComponent = …;`
3. Apply aliases, and keep only names that exist at runtime (`name in docx`). This drops the unexported `Begin`, `FieldInstruction`, `Separate`, `End` and `Break`.
4. Assert that every remaining name is either some `ELEMENTS[k].docx` or a key of `NOT_MAPPED`.
5. Assert that every `NOT_MAPPED` key is in the set. That catches stale entries.

Print the table with `console.info` as `name → kind | reason`.

### 6. `test/inline-elements.test.tsx` (AC14)

Write one test per kind added in this unit. Each renders the kind as JSX and asserts its verified output from Change 1 in `word/document.xml`. Cover both placements:

- run-content kinds as direct Paragraph children (wrapped by rule 5) and inside a `<TextRun>`;
- `<InsertedTextRun id={1} author="A" date="2026-01-01T00:00:00Z">ins</InsertedTextRun>` with string children.

Add one case: `<DeletedTextRun …>a<Break/>b</DeletedTextRun>` canonicalizes to two DeletedTextRuns, and writes two `<w:del>`, the second containing `<w:br/>`.

## Verify

```sh
pnpm test
pnpm run type-check
pnpm run build
pnpm run test:react
pnpm run examples
```

This is the last unit of phase 1, so the Verification block in `00-context.md` must pass in full.

## Watch out

- The coverage regexes read docx.js's declaration file. On a docx.js upgrade, a failure here is the intended signal; do not loosen the regexes to make it pass. A parse failure (an empty set) must fail the test too: assert the set has more than 20 names.
- `CheckBox` writes `w14:` elements. docx.js declares `w14` on the document root, so Word opens it. Do not add namespace handling.
- `SimpleMailMergeField` writes `«Name»` as cached text. That is docx.js's choice; assert it, do not change it.
