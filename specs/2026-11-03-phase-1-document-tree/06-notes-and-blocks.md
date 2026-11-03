# 06 — Footnotes, comments, table of contents, text boxes

> Part of `00-context.md`. **Read that first.** This file assumes its background, decisions and out-of-scope list and does not repeat them.

- **Satisfies**: AC13
- **You will see**: a document written with `<Paragraph>Claim<Footnote>Source: 2026 report</Footnote></Paragraph>`, a `<Comment id={0} author="Ada">` on Document marking a range, `<TableOfContents alias="Contents" headingStyleRange="1-3" hyperlink />` and a `<Textbox>` opens in Word. It shows a numbered footnote, a margin comment over the marked text, a table-of-contents field (Word fills it on open when `features={{ updateFields: true }}`) and a text box.

## Goal

Add the seven kinds whose content docx.js keeps outside the paragraph they appear in, or that are section-level blocks: `Footnote`, `Comment`, `CommentRangeStart`, `CommentRangeEnd`, `CommentReference`, `TableOfContents` and `Textbox`.

Footnotes are written inline and numbered by the writer (decision 9). Comments are `Document` children whose ranges are marked inline by id (decision 8).

## Files

- `src/schema/elements.ts`: seven rows plus grammar changes (Change 1).
- `src/tree/canonical.ts`: rules 17–19 (Change 2).
- `src/write/build.ts`: a build context, the footnote collector, comment collection, and the new builders.
- `src/components.ts`, `src/types.ts`, `src/index.ts`: seven components and their prop types.
- `test/support/docx-xml.ts`: normalize `v:shape` ids (Change 4).
- `test/support/cases.tsx`: add a `notes-and-blocks` case. A new snapshot, not a changed one.
- `test/canonical.test.ts`: tests for rules 17–19.
- `test/notes-and-blocks.test.tsx`: new (AC13).

## Changes

### 1. Kinds and grammar

| Kind | docx | children | text | ooxml | props |
|---|---|---|---|---|---|
| Footnote | `"FootnoteReferenceRun"` | `["Paragraph", "Table"]` | no | `w:footnoteReference` | `{}` |
| Comment | `"Comment"` | `["Paragraph", "Table"]` | no | `w:comment` | `Omit<CommentOptions, "children">` |
| CommentRangeStart | `"CommentRangeStart"` | `[]` | no | `w:commentRangeStart` | `{ readonly id: number }` |
| CommentRangeEnd | `"CommentRangeEnd"` | `[]` | no | `w:commentRangeEnd` | `{ readonly id: number }` |
| CommentReference | `"CommentReference"` | `[]` | no | `w:commentReference` | `{ readonly id: number }` |
| TableOfContents | `"TableOfContents"` | `[]` | no | `w:sdt` | `{ readonly alias?: string } & docx.ITableOfContentsOptions` |
| Textbox | `"Textbox"` | `["Paragraph"]` | no | `w:pict` | `Omit<TextboxOptions, "children">` |

- `CommentOptions` is `docx.ICommentOptions` (exported): `{ id: number; children; initials?; author?; date?: Date }`.
- `TextboxOptions` is `ConstructorParameters<typeof docx.Textbox>[0]`, because `ITextboxOptions` is not exported. It is `Omit<IParagraphOptions, "style"> & { style?: VmlShapeStyle }`.

Grammar changes:
- `Document.children`: `["Section", "Comment"]`.
- `Section.children`: add `"TableOfContents"` and `"Textbox"`. docx.js types both as `FileChild`, so they are Section-body only, not Header, Footer or TableCell.
- `INLINE`: add `"Footnote"`, `"CommentRangeStart"` and `"CommentRangeEnd"`.
- `RUN_CONTENT`: add `"CommentReference"`. docx.js writes it as `<w:r><w:commentReference/></w:r>`, so canonical rule 5 wraps it in a TextRun when it stands directly in a Paragraph.

**Textbox children are Paragraphs, not inline content.** docx.js types `children` as `ParagraphChild[]`, but writes them straight into `<w:txbxContent>`, which must hold `w:p`. Verified on 2026-11-03: `new Textbox({ children: [new Paragraph("in box")] })` wrote `<w:txbxContent><w:p>…</w:p></w:txbxContent>` inside a `<w:p><w:pict><v:shape>`.

### 2. Canonical rules 17–19

- **17. Loose content in Footnote, Comment and Textbox.** Consecutive strings and inline-kind children directly inside one of these are wrapped into one `Paragraph`. Strings first go through rule 2's wrapping. So `<Footnote>Source: 2026 report</Footnote>` becomes `Footnote > Paragraph > TextRun > "Source: 2026 report"`.
- **18. Footnote placement.**
  - A Footnote anywhere inside a `Header`, `Footer`, `Comment` or another `Footnote` throws: `TreeError(path, "Footnote is only allowed in the document body")`. docx.js writes footnote references only from body content.
  - Inside the body it is legal anywhere an INLINE kind is: Paragraph, hyperlinks, Bookmark, and paragraphs inside TableCell.
- **19. Comment ids.**
  - Two `Comment`s with the same `id` throw.
  - Every `CommentRangeStart`, `CommentRangeEnd` and `CommentReference` id must match a `Comment` id, or throw `TreeError(path, "No <Comment id={n}>")`.
  - A `Comment` with no range or reference is legal. Word shows it anchored at the document start.

### 3. Writer

Introduce a build context. Change `BUILD`'s signature to `(node, ctx: BuildCtx) => Built[K]` and pass `ctx` through `buildChild`:

```ts
type BuildCtx = { readonly footnoteIds: ReadonlyMap<Node<"Footnote">, number> };
```

Before building, `buildDocument` walks the tree in document order:
- Section bodies in order, depth-first through Paragraph, Table/TableRow/TableCell, hyperlink and Bookmark children.
- Never into Header, Footer or Comment, because rule 18 keeps Footnotes out of them.

Each `Footnote` node gets the next id, starting at **1**. docx.js reserves −1 and 0 for separators: the verified output has `w:footnoteReference w:id="1"` and `<w:footnote w:id="1">`.

| Kind | builds |
|---|---|
| Footnote | `new docx.FootnoteReferenceRun(ctx.footnoteIds.get(node)!)`. Its paragraphs are built once into `footnotes[id] = { children }` |
| Comment | not built in place. Document collects `{ ...props, children: builtChildren }` into `comments.children` |
| CommentRangeStart / CommentRangeEnd | `new docx.CommentRangeStart(id)` / `new docx.CommentRangeEnd(id)` |
| CommentReference | `new docx.CommentReference(id)`, a run child |
| TableOfContents | `new docx.TableOfContents(alias, rest)` |
| Textbox | `new docx.Textbox({ ...props, children: builtParagraphs as any })`, with a comment pointing at Change 1 |

The Document builder becomes:

```ts
new docx.Document({
  ...props,
  sections,
  ...(footnoteCount > 0 ? { footnotes } : {}),
  ...(comments.length > 0 ? { comments: { children: comments } } : {}),
})
```

Omit the keys when empty, so documents without notes keep their exact current output. The characterization snapshots must not change.

### 4. Snapshot normalization (`test/support/docx-xml.ts`)

docx.js gives every text box a random VML shape id; the 2026-11-03 probe wrote `<v:shape id="corbyszrcl2-uwybwda5-" …>`. Replace `v:shape` `id` values with `vShape1`, `vShape2`, … in order of appearance.

The existing `output is stable across two renders` test catches any other random id once the `notes-and-blocks` case is added. If it fails, normalize that id the same way. Do not loosen the comparison.

### 5. Components

```tsx
export const Footnote = element<FootnoteProps>("Footnote");            // FootnoteProps = { children?: ReactNode }
export const Comment = element<CommentProps>("Comment");               // Omit<docx.ICommentOptions, "children"> & Kids
export const CommentRangeStart = element<{ id: number }>("CommentRangeStart");
export const CommentRangeEnd = element<{ id: number }>("CommentRangeEnd");
export const CommentReference = element<{ id: number }>("CommentReference");
export const TableOfContents = element<TableOfContentsProps>("TableOfContents"); // { alias?: string } & docx.ITableOfContentsOptions
export const Textbox = element<TextboxProps>("Textbox");
```

`Comment` shadows nothing in this package. docx.js exports its own `Comment` class, so users who import both must alias one. Mention this in the `Comment` JSDoc.

### 6. `test/notes-and-blocks.test.tsx` (AC13)

1. **Footnote numbering.**
   - Three Footnotes in this body order: Section 0 paragraph, then a TableCell paragraph, then Section 1. They get ids 1, 2 and 3, in that order, in both `word/document.xml` (`w:footnoteReference w:id`) and `word/footnotes.xml`.
   - `<Footnote>text</Footnote>` writes `text` inside `<w:footnote w:id="1">`.
2. **Footnote placement.** A Footnote inside a Footer throws `TreeError`.
3. **Comments.**
   - `<Comment id={0} author="Ada" date={new Date("2026-01-01T00:00:00Z")}>c0</Comment>` with `CommentRangeStart`/`CommentRangeEnd`/`CommentReference` id 0 around a run writes `<w:commentRangeStart w:id="0"/>`, `<w:commentRangeEnd w:id="0"/>`, `<w:r><w:commentReference w:id="0"/></w:r>`, and in `word/comments.xml` `<w:comment w:id="0" w:author="Ada" w:date="2026-01-01T00:00:00.000Z">` containing `c0`.
   - An unmatched range id throws.
   - A duplicate Comment id throws.
4. **Table of contents.** `<TableOfContents alias="Contents" headingStyleRange="1-3" hyperlink />` writes `<w:sdt>`, `<w:alias w:val="Contents"/>` and `TOC \h \o &quot;1-3&quot;`.
5. **Text box.** `<Textbox style={{ width: "200pt", height: "50pt" }}><Paragraph>in box</Paragraph></Textbox>` writes `<w:txbxContent><w:p>` containing `in box`.
6. **No notes, no keys.** A document with no Footnote and no Comment writes exactly the same normalized XML as before this unit. The characterization suite proves this; state it in a test name, `"documents without notes are unchanged"`, which runs the `CASES` snapshot comparison for three representative cases.

## Verify

```sh
pnpm test
pnpm run type-check
pnpm run build
```

## Watch out

- docx.js `Document` gets `footnotes` and `comments` from options at construction. They cannot be added afterwards, so collect them before calling `new docx.Document`.
- Do not register footnote ids in a module-level counter. Two documents rendered in one process must both start at 1. The ids live in the per-build `ctx`.
- `Comment.date` is a `Date` in the tree. That is one of the two non-JSON values decision 1 allows. `test/tree-input.test.tsx`'s JSON round trip must keep using image-free, comment-free cases.
