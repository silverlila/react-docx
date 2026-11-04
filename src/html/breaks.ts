/** Break keys, and measureBreaks, which measures the drawn pages for the breaks they need.
 *
 *  - paginate gives each body block a key (ResolvedPart.keys), which DocxPreview draws as
 *    `data-docx-key`; measureBreaks reads it back and answers with the keys of the breaks it found, which
 *    paginate takes in as MeasuredBreaks. Both sets reach callers through "./html" (ResolvedPart.keys and
 *    resolveDocument's `measured`), so the strings formatKey writes are public and must not change.
 *  - Body blocks are numbered in document order across sections; a paragraph's pieces are what its page
 *    and column breaks cut it into; a piece's texts are numbered in order, nested ones included.
 *  - measureBreaks needs a laid-out DOM (a browser); under react-dom/server it never runs. */

/** A point in a paragraph piece's text: the index of a text and a character offset into it. */
export type Split = readonly [number, number];

/** What a key names. block: the body block's number. */
export type BreakKey =
  /** `b<n>.<k>`: piece k of block n, and a break before it. A block other than a paragraph is one piece,
   *  0, though the parts of a table carry table keys. */
  | { readonly kind: "piece"; readonly block: number; readonly piece: number }
  /** `b<n>.<k>@<text>:<offset>`: the part of piece k of block n that a measured split starts. */
  | { readonly kind: "continuation"; readonly block: number; readonly piece: number; readonly from: Split }
  /** `s<n>.<k>@<text>:<offset>`: a measured break inside piece k of block n, before that character. */
  | { readonly kind: "split"; readonly block: number; readonly piece: number; readonly at: Split }
  /** `t<n>:<first row>:<repeated header rows>`: the part of table n on one page. */
  | { readonly kind: "table"; readonly block: number; readonly start: number; readonly repeated: number }
  /** `r<n>:<i>`: a break before row i of table n. */
  | { readonly kind: "row"; readonly block: number; readonly row: number };

/** Page breaks found by measuring the drawn pages, as formatted keys: pieces, splits and rows. */
export type MeasuredBreaks = ReadonlySet<string>;

export const NO_BREAKS: MeasuredBreaks = new Set();

export function formatKey(key: BreakKey): string {
  switch (key.kind) {
    case "piece":
      return `b${key.block}.${key.piece}`;
    case "continuation":
      return `b${key.block}.${key.piece}@${key.from[0]}:${key.from[1]}`;
    case "split":
      return `s${key.block}.${key.piece}@${key.at[0]}:${key.at[1]}`;
    case "table":
      return `t${key.block}:${key.start}:${key.repeated}`;
    case "row":
      return `r${key.block}:${key.row}`;
    default: {
      const exhaustive: never = key;
      throw new Error(`formatKey: unknown key ${JSON.stringify(exhaustive)}`);
    }
  }
}

const KEY_PATTERNS: readonly (readonly [RegExp, (numbers: number[]) => BreakKey])[] = [
  [/^b(\d+)\.(\d+)$/, ([block, piece]) => ({ kind: "piece", block, piece })],
  [/^b(\d+)\.(\d+)@(\d+):(\d+)$/, ([block, piece, text, offset]) => ({ kind: "continuation", block, piece, from: [text, offset] })],
  [/^s(\d+)\.(\d+)@(\d+):(\d+)$/, ([block, piece, text, offset]) => ({ kind: "split", block, piece, at: [text, offset] })],
  [/^t(\d+):(\d+):(\d+)$/, ([block, start, repeated]) => ({ kind: "table", block, start, repeated })],
  [/^r(\d+):(\d+)$/, ([block, row]) => ({ kind: "row", block, row })],
];

/** The key `text` formats, or null when it is not one. */
export function parseKey(text: string): BreakKey | null {
  for (const [pattern, build] of KEY_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) return build(match.slice(1).map(Number));
  }
  return null;
}

/** The key a drawn body block carries. */
function keyOf(el: HTMLElement): BreakKey {
  const key = parseKey(el.dataset.docxKey ?? "");
  if (key === null) throw new Error(`measureBreaks: block has no break key: data-docx-key="${el.dataset.docxKey}"`);
  return key;
}

/** How much taller than its page a page Word laid out may be before it is measured: more than this, and
 *  Word broke the page without recording it. */
const LAID_OUT_SLACK = 1.2;

/** The least room a page's body needs, as a share of the page, before it is measured: less, and what
 *  crowds it out is drawn here as Word does not (a floating picture drawn in line). */
const MIN_ROOM = 0.2;

/** Where to break paragraph `el` between lines: after the last of its lines from `sliceTop` that ends by
 *  `foot`. Returns the key naming the first character of the next line, and that line's top; null when
 *  no line of the slice can stay, or the paragraph keeps its lines together. With widow control, no line
 *  is left alone on either side of the break. `toPage` maps a viewport y to the page's. */
function splitLine(el: HTMLElement, sliceTop: number, foot: number, toPage: (clientY: number) => number): { key: string; top: number } | null {
  const piece = keyOf(el);
  if ((piece.kind !== "piece" && piece.kind !== "continuation") || el.dataset.docxKeepLines !== undefined) return null;
  const chars: { span: HTMLElement; node: Text; offset: number }[] = [];
  for (const span of el.querySelectorAll<HTMLElement>("[data-docx-text]")) {
    if (span.closest("[data-docx-floating]") !== null) continue;
    for (const node of span.childNodes) if (node instanceof Text) for (let o = 0; o < node.length; o++) chars.push({ span, node, offset: o });
  }
  const range = el.ownerDocument.createRange();
  const lines: { start: number; top: number; bottom: number }[] = [];
  chars.forEach((c, i) => {
    range.setStart(c.node, c.offset);
    range.setEnd(c.node, c.offset + 1);
    const r = range.getBoundingClientRect();
    if (r.height === 0) return;
    const top = toPage(r.top);
    const bottom = toPage(r.bottom);
    const line = lines[lines.length - 1];
    if (line === undefined || top >= line.bottom - 1) lines.push({ start: i, top, bottom });
    else line.bottom = Math.max(line.bottom, bottom);
  });
  const first = lines.findIndex((line) => line.top >= sliceTop - 1);
  if (first === -1) return null;
  let cut = lines.findIndex((line, i) => i >= first && line.bottom > foot);
  if (cut === -1 || cut <= first) return null;
  if (el.dataset.docxWidowControl !== undefined) {
    if (lines.length - cut === 1) cut--;
    if (cut - first < (first === 0 ? 2 : 1) || cut <= first) return null;
  }
  const at = chars[lines[cut].start];
  const text = Number(at.span.dataset.docxText ?? "0");
  const from = Number(at.span.dataset.docxFrom ?? "0");
  const key = formatKey({ kind: "split", block: piece.block, piece: piece.piece, at: [text, from + at.offset] });
  return { key, top: lines[cut].top };
}

/** The breaks the drawn pages need: on each page taller than its page, the body blocks are packed into
 *  page-high slices, breaking before the first block (or table row) that crosses a slice's foot. A block
 *  kept with the next one goes with it; a block taller than a page stays where it starts. A page Word
 *  laid out (it ends at a rendered break) is left as it is unless it overflows by more than
 *  LAID_OUT_SLACK: a little, and the text is set taller here than in Word, and breaking it would push
 *  every later page off Word's. */
export function measureBreaks(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const page of root.querySelectorAll<HTMLElement>("[data-docx-page]")) {
    const style = getComputedStyle(page);
    const pageHeight = parseFloat(style.minHeight);
    const limit = page.dataset.docxLaidOut === undefined ? pageHeight + 1 : pageHeight * LAID_OUT_SLACK;
    if (!(page.offsetHeight > limit)) continue;
    const box = page.getBoundingClientRect();
    const scale = box.height / page.offsetHeight || 1;
    const y = (el: Element, edge: "top" | "bottom") => (el.getBoundingClientRect()[edge] - box.top) / scale;
    const body = page.querySelector("[data-docx-body]");
    if (body === null) continue;
    const footer = page.querySelector<HTMLElement>("[data-docx-footer]")?.offsetHeight ?? 0;
    // Footnotes go on the page that references them: a slice needs room for its own.
    const notes = new Map<string, number>();
    for (const note of page.querySelectorAll<HTMLElement>("[data-docx-footnote]")) notes.set(note.dataset.docxFootnote ?? "", note.offsetHeight);
    const allNotes = page.querySelector<HTMLElement>("[data-docx-footnotes]")?.offsetHeight ?? 0;
    const rule = Math.max(0, allNotes - [...notes.values()].reduce((sum, h) => sum + h, 0));
    const refsOf = (el: Element) => [...el.querySelectorAll<HTMLElement>("[data-docx-note]")].map((ref) => ref.dataset.docxNote ?? "");
    const blocks = [...body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.docxKey !== undefined && el.dataset.docxFloating === undefined
    );
    let sliceTop = y(body, "top");
    const foot = pageHeight - parseFloat(style.paddingBottom) - footer;
    let room = foot - sliceTop;
    if (room < pageHeight * MIN_ROOM) continue;
    // A later slice becomes a page of its own, whose header may differ from this page's (a first-page
    // header): its body is taken to start at the top margin.
    const headerZone = page.querySelector<HTMLElement>("[data-docx-header]");
    const marginTop = parseFloat(style.paddingTop) + (headerZone === null ? 0 : parseFloat(getComputedStyle(headerZone).minHeight) || 0);
    const laterRoom = foot - marginTop >= pageHeight * MIN_ROOM ? foot - marginTop : room;
    let first = 0;
    let sliceNotes = new Set<string>();
    const notesHeight = (refs: readonly string[] = []) => {
      const inSlice = new Set([...sliceNotes, ...refs]);
      return inSlice.size === 0 ? 0 : rule + [...inSlice].reduce((sum, n) => sum + (notes.get(n) ?? 0), 0);
    };
    const fits = (bottom: number, refs: readonly string[]) => bottom - sliceTop + notesHeight(refs) <= room;
    const startSlice = (top: number, refs: readonly string[]) => {
      sliceTop = top;
      sliceNotes = new Set(refs);
      room = laterRoom;
    };
    const breakBefore = (i: number) => {
      let j = i;
      while (j > first && blocks[j - 1].dataset.docxKeepNext !== undefined) j--;
      if (j === first) j = i;
      const key = keyOf(blocks[j]);
      found.push(formatKey(key.kind === "table" ? { kind: "piece", block: key.block, piece: 0 } : key));
      startSlice(y(blocks[j], "top"), blocks.slice(j, i).flatMap(refsOf));
      first = j;
    };
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      const key = keyOf(el);
      if (key.kind !== "table") {
        // A paragraph that crosses the foot breaks between its lines when it can, else moves whole.
        while (!fits(y(el, "bottom"), refsOf(el))) {
          const split = splitLine(el, sliceTop, sliceTop + room - notesHeight(), (clientY) => (clientY - box.top) / scale);
          if (split !== null) {
            found.push(split.key);
            startSlice(split.top, []);
            first = i;
            continue;
          }
          if (i > first) breakBefore(i);
          break;
        }
        for (const ref of refsOf(el)) sliceNotes.add(ref);
        continue;
      }
      const head = el.querySelectorAll(":scope > thead > tr").length;
      const rows = [...el.querySelectorAll<HTMLElement>(":scope > thead > tr, :scope > tbody > tr")];
      for (let k = head; k < rows.length; k++) {
        const refs = refsOf(rows[k]);
        if (!fits(y(rows[k], "bottom"), refs)) {
          // Breaking before the first body row would leave only the header rows: move the table instead.
          if (k === head) {
            if (i > first && y(el, "top") > sliceTop + 1) breakBefore(i);
          } else {
            found.push(formatKey({ kind: "row", block: key.block, row: key.start + k - key.repeated }));
            startSlice(y(rows[k], "top"), []);
            first = i;
          }
        }
        for (const ref of refs) sliceNotes.add(ref);
      }
    }
  }
  return found;
}
