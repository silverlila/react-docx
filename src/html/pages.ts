/** resolveDocument: a canonical tree → the pages Word lays it out on. resolveSections (resolve.ts) resolves
 *  its sections; paginate breaks them into pages, where that is known without measuring text.
 *
 *  - A page starts at each authored page break, at a paragraph with pageBreakBefore, at each section that
 *    is not continuous, and at each page break Word recorded when it last laid the document out
 *    (w:lastRenderedPageBreak), so a document Word saved breaks where Word broke it. Content that
 *    overflows a page between those breaks stays on it: the page grows.
 *  - An authored page break always starts a page, so two in a row leave a blank page. The others start
 *    one only when the current page has something on it (pageBreakBefore, a section start) or something
 *    visible on it (Word's rendered breaks, which it also writes right after an authored break and in the
 *    first run after empty paragraphs at the top of a page).
 *  - A paragraph broken across pages keeps its marker, space before and first-line indent on its first
 *    piece and its space after on its last. Word keeps a page break's paragraph mark on the break's page,
 *    so a paragraph that ends with a break leaves nothing on the next page.
 *  - A table breaks before the row holding a rendered break, and repeats its header rows on the next page.
 *    A row Word broke across pages (a rendered break after content in a cell) is split there: each page
 *    gets the row with each cell's content up to its next rendered break.
 *  - Breaks inside table cells otherwise, text boxes, headers, footers and footnotes start no page.
 *  - A continuous section adds a part, with its own columns, to the page it starts on. Any other section
 *    starts a page even when the previous one is empty: docx.js ends each section but the last with an
 *    empty paragraph holding its w:sectPr, which Word sets on that page.
 *  - Numbering: a section that restarts numbering (pageNumberStart) restarts it on its first page; others
 *    count on. Each page shows its number in its section's format.
 *  - Headers and footers: a section's first page shows its first-page header when titlePage is set, an
 *    even page its even header when the document has evenAndOddHeaderAndFooters, any other page its
 *    default header. A section without one of a type inherits the previous section's of that type; a page
 *    whose header has none at all shows none.
 *  - Breaks found by measuring the drawn pages (MeasuredBreaks, breaks.ts) start a page where the page has
 *    content.
 *  - Each page lists the footnotes it references. An empty last page is dropped. */

import { formatNumber } from "../ooxml/markers";
import type { TreePath } from "../read/diagnostics";
import type { DocumentNode } from "../schema/elements";
import { NO_BREAKS, formatKey, parseKey, type MeasuredBreaks, type Split } from "./breaks";
import type {
  PageGeometry,
  ResolvedBlock,
  ResolvedColumns,
  ResolvedFootnote,
  ResolvedInline,
  ResolvedRow,
  ResolvedSection,
} from "./model";
import { resolveSections } from "./resolve";

/** columnStarts: the index in `blocks` where each column starts, when the document says where its columns
 *  break; null leaves a multi-column part to balance its columns. keys: each block's break key
 *  (breaks.ts). */
export type ResolvedPart = {
  readonly columns: ResolvedColumns | null;
  readonly blocks: readonly ResolvedBlock[];
  readonly keys: readonly string[];
  readonly columnStarts: readonly number[] | null;
};

export type ResolvedPage = PageGeometry & {
  /** The path of the section the page starts in. */
  readonly path: TreePath;
  /** The page's number as a PAGE field shows it. */
  readonly number: string;
  /** The page ends where Word ended it when it last laid the document out, so measuring leaves it be. */
  readonly laidOut: boolean;
  /** The 1-based number of the section the page starts in, and how many pages that section has. */
  readonly section: number;
  readonly sectionPages: number;
  readonly header: readonly ResolvedBlock[];
  readonly parts: readonly ResolvedPart[];
  readonly footnotes: readonly ResolvedFootnote[];
  readonly footer: readonly ResolvedBlock[];
};

type Paragraph = Extract<ResolvedBlock, { kind: "paragraph" }>;
type Table = Extract<ResolvedBlock, { kind: "table" }>;
type Break = "authored" | "rendered" | "column" | "measured";
type Stories = Partial<Record<"default" | "first" | "even", readonly ResolvedBlock[]>>;

type DraftPart = {
  readonly columns: ResolvedColumns | null;
  readonly blocks: ResolvedBlock[];
  readonly keys: string[];
  /** Where each column after the first starts. */
  readonly columnStarts: number[];
  /** A continuous section's part that follows a multi-column part: Word marks its start as rendered. */
  readonly afterColumns: boolean;
};

type Draft = {
  readonly section: number;
  readonly indexInSection: number;
  readonly number: number;
  readonly parts: DraftPart[];
  /** The page ends where Word ended it when it last laid the document out (a rendered break). */
  laidOut: boolean;
};

const draftPart = (columns: ResolvedColumns | null, afterColumns = false): DraftPart => ({
  columns,
  blocks: [],
  keys: [],
  columnStarts: [],
  afterColumns,
});

const hasContent = (page: Draft): boolean => page.parts.some((part) => part.blocks.length > 0);

function isVisibleInline(inline: ResolvedInline): boolean {
  switch (inline.kind) {
    case "pageBreak":
    case "columnBreak":
      return false;
    case "text":
      return inline.text.trim().length > 0;
    case "link":
    case "anchor":
      return inline.inlines.some(isVisibleInline);
    case "raw":
      return false;
    default:
      return true;
  }
}

const isVisible = (block: ResolvedBlock): boolean =>
  block.kind !== "paragraph" || block.marker !== null || block.inlines.some(isVisibleInline);

const hasVisible = (page: Draft): boolean => page.parts.some((part) => part.blocks.some(isVisible));

/** `inlines` cut at its page breaks, top level and inside links and anchors: n + 1 segments around n breaks. */
function splitInlines(inlines: readonly ResolvedInline[]): { segments: ResolvedInline[][]; breaks: Break[] } {
  const segments: ResolvedInline[][] = [[]];
  const breaks: Break[] = [];
  const last = () => segments[segments.length - 1];
  for (const inline of inlines) {
    if (inline.kind === "pageBreak" || inline.kind === "columnBreak") {
      breaks.push(inline.kind === "pageBreak" ? (inline.rendered ? "rendered" : "authored") : "column");
      segments.push([]);
    } else if (inline.kind === "link" || inline.kind === "anchor") {
      const inner = splitInlines(inline.inlines);
      inner.segments.forEach((segment, i) => {
        if (i > 0) {
          breaks.push(inner.breaks[i - 1]);
          segments.push([]);
        }
        if (segment.length > 0) last().push({ ...inline, inlines: segment });
      });
    } else {
      last().push(inline);
    }
  }
  return { segments, breaks };
}

/** `inlines` with each text numbered in order, nested ones included, for split keys to name. */
function numberTexts(inlines: readonly ResolvedInline[]): ResolvedInline[] {
  let index = 0;
  const walk = (list: readonly ResolvedInline[]): ResolvedInline[] =>
    list.map((inline) => {
      if (inline.kind === "text") return { ...inline, at: [index++, 0] as const };
      if (inline.kind === "link" || inline.kind === "anchor") return { ...inline, inlines: walk(inline.inlines) };
      return inline;
    });
  return walk(inlines);
}

/** The split points measured for piece `piece` of block `block`, in text order. */
function splitsOf(measured: MeasuredBreaks, block: number, piece: number): Split[] {
  const out: Split[] = [];
  for (const text of measured) {
    const key = parseKey(text);
    if (key?.kind === "split" && key.block === block && key.piece === piece) out.push(key.at);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** `inlines` before and from character `offset` of text `index`. */
function cutAt(inlines: readonly ResolvedInline[], [index, offset]: Split): [ResolvedInline[], ResolvedInline[]] {
  const before: ResolvedInline[] = [];
  const after: ResolvedInline[] = [];
  let cut = false;
  for (const inline of inlines) {
    if (cut) {
      after.push(inline);
    } else if (inline.kind === "text" && inline.at !== undefined && inline.at[0] === index) {
      const local = offset - inline.at[1];
      if (local > 0) before.push({ ...inline, text: inline.text.slice(0, local) });
      if (local < inline.text.length) after.push({ ...inline, text: inline.text.slice(local), at: [index, offset] });
      cut = true;
    } else if (inline.kind === "text" && inline.at !== undefined && inline.at[0] > index) {
      after.push(inline);
      cut = true;
    } else if (inline.kind === "link" || inline.kind === "anchor") {
      const [head, rest] = cutAt(inline.inlines, [index, offset]);
      if (head.length > 0) before.push({ ...inline, inlines: head });
      if (rest.length > 0) {
        after.push({ ...inline, inlines: rest });
        cut = true;
      }
    } else {
      before.push(inline);
    }
  }
  return [before, after];
}

/** A piece cut at each split point: the first part, then one from each point. */
function cutAtSplits(inlines: ResolvedInline[], splits: readonly Split[]): { inlines: ResolvedInline[]; from: Split }[] {
  const parts: { inlines: ResolvedInline[]; from: Split }[] = [];
  let rest = inlines;
  let from: Split = [0, 0];
  for (const split of splits) {
    const [head, tail] = cutAt(rest, split);
    if (head.length === 0 || tail.length === 0) continue;
    parts.push({ inlines: head, from });
    rest = tail;
    from = split;
  }
  parts.push({ inlines: rest, from });
  return parts;
}

/** A piece of a paragraph broken across pages: its marker, space before and first-line indent stay on its
 *  first piece, its space after on its last. */
function paragraphPiece(p: Paragraph, inlines: ResolvedInline[], first: boolean, last: boolean): Paragraph {
  return {
    ...p,
    marker: first ? p.marker : null,
    inlines,
    format: {
      ...p.format,
      spaceBeforePt: first ? p.format.spaceBeforePt : 0,
      firstLinePt: first ? p.format.firstLinePt : 0,
      spaceAfterPt: last ? p.format.spaceAfterPt : 0,
      pageBreakBefore: false,
    },
  };
}

/** `blocks` cut at their paragraphs' rendered breaks: what Word set on each page, in order. A paragraph
 *  with nothing but breaks keeps its empty line, after its last break. */
function cutAtRenderedBreaks(blocks: readonly ResolvedBlock[]): ResolvedBlock[][] {
  const groups: ResolvedBlock[][] = [[]];
  for (const block of blocks) {
    if (block.kind !== "paragraph") {
      groups[groups.length - 1].push(block);
      continue;
    }
    const { segments, breaks } = splitInlines(block.inlines);
    if (breaks.length === 0) {
      groups[groups.length - 1].push(block);
      continue;
    }
    const pieces: { group: ResolvedBlock[]; inlines: ResolvedInline[] }[] = [];
    segments.forEach((inlines, i) => {
      if (i > 0 && breaks[i - 1] === "rendered") groups.push([]);
      if (inlines.length > 0) pieces.push({ group: groups[groups.length - 1], inlines });
    });
    if (pieces.length === 0) pieces.push({ group: groups[groups.length - 1], inlines: [] });
    pieces.forEach(({ group, inlines }, k) => group.push(paragraphPiece(block, inlines, k === 0, k === pieces.length - 1)));
  }
  return groups;
}

/** Each cell's content as Word set it on successive pages, from the page the row starts on: a rendered
 *  break at the start of a cell is the row's own page break. */
function cellPages(row: ResolvedRow): { startsPage: boolean; cells: ResolvedBlock[][][] } {
  let startsPage = false;
  const cells = row.cells.map((cell) => {
    const groups = cutAtRenderedBreaks(cell.blocks);
    if (groups.length > 1 && !groups[0].some(isVisible)) {
      startsPage = true;
      return groups.slice(1);
    }
    return groups;
  });
  return { startsPage, cells };
}

const EMPTY_CELL_PARAGRAPH = (cell: ResolvedRow["cells"][number]): ResolvedBlock[] => {
  const template = cell.blocks.find((b): b is Paragraph => b.kind === "paragraph");
  return template === undefined ? [] : [{ ...template, marker: null, inlines: [] }];
};

/** A row Word broke across pages, as one row per page: each cell's content up to its next rendered break. */
function rowPieces(row: ResolvedRow, cells: readonly ResolvedBlock[][][]): ResolvedRow[] {
  const count = Math.max(...cells.map((groups) => groups.length));
  return Array.from({ length: count }, (_, p) => ({
    ...row,
    heightPt: p === 0 ? row.heightPt : null,
    cells: row.cells.map((cell, c) => ({ ...cell, blocks: cells[c][p] ?? EMPTY_CELL_PARAGRAPH(cell) })),
  }));
}

function containsRenderedBreak(blocks: readonly ResolvedBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "paragraph") return splitInlines(block.inlines).breaks.includes("rendered");
    if (block.kind === "table") return block.rows.some((row) => row.cells.some((cell) => containsRenderedBreak(cell.blocks)));
    return false;
  });
}

function paginateSections(sections: readonly ResolvedSection[], measured: MeasuredBreaks): Draft[] {
  const pages: Draft[] = [];
  let section = 0;
  let indexInSection = 0;
  let number = 0;
  const current = (): Draft => pages[pages.length - 1];
  const part = () => current().parts[current().parts.length - 1];
  // A floating text box goes on the page of the paragraph after it, which it is anchored in (the reader
  // puts it before that paragraph): it waits until that paragraph's first piece is placed.
  let floats: [ResolvedBlock, string][] = [];
  const emit = (block: ResolvedBlock, key: string) => {
    if (block.kind === "textbox" && block.float !== null) {
      floats.push([block, key]);
      return;
    }
    const waiting = floats;
    floats = [];
    for (const [b, k] of [...waiting, [block, key] as [ResolvedBlock, string]]) {
      part().blocks.push(b);
      part().keys.push(k);
    }
  };
  const flushFloats = () => {
    const waiting = floats;
    floats = [];
    for (const [b, k] of waiting) {
      part().blocks.push(b);
      part().keys.push(k);
    }
  };

  const newPage = () => {
    indexInSection++;
    number++;
    pages.push({ section, indexInSection, number, parts: [draftPart(part().columns)], laidOut: false });
  };
  const renderedBreak = () => {
    current().laidOut = true;
    newPage();
  };
  /** A break in a multi-column part moves to the next column, or past the last one to a new page; Word
   *  also marks the start of a part's first column as rendered. In one column a column break is a page
   *  break. */
  const breakPage = (why: Break | "content") => {
    const here = part();
    const count = here.columns?.count ?? 1;
    const partStarted = here.blocks.some(isVisible);
    if (why === "rendered" && !partStarted && (count > 1 || here.afterColumns)) return;
    if (count > 1 && (why === "rendered" || why === "column")) {
      if (here.columnStarts.length + 1 < count) here.columnStarts.push(here.blocks.length);
      else if (why === "rendered") renderedBreak();
      else newPage();
      return;
    }
    if (why === "rendered") {
      if (hasVisible(current())) renderedBreak();
    } else if (why === "authored" || why === "column" || hasContent(current())) {
      newPage();
    }
  };
  const measuredBreak = (key: string) => {
    if (measured.has(key) && hasContent(current())) newPage();
  };

  const placeParagraph = (p: Paragraph, n: number) => {
    if (p.format.pageBreakBefore) breakPage("content");
    const { segments, breaks } = splitInlines(p.inlines);
    // A piece with nothing visible (a bookmark, an empty run) goes with the piece after it, or the last
    // one with the piece before it.
    const pieces = segments.map((inlines, i) => ({ inlines, before: i === 0 ? null : breaks[i - 1] }));
    for (let i = 0; i < pieces.length - 1; i++) {
      if (!pieces[i].inlines.some(isVisibleInline)) {
        pieces[i + 1].inlines = [...pieces[i].inlines, ...pieces[i + 1].inlines];
        pieces[i].inlines = [];
      }
    }
    const tail = pieces[pieces.length - 1];
    const host = pieces.slice(0, -1).reverse().find((piece) => piece.inlines.length > 0);
    if (host !== undefined && !tail.inlines.some(isVisibleInline)) {
      host.inlines = [...host.inlines, ...tail.inlines];
      tail.inlines = [];
    }
    const kept = pieces.filter((piece, i) => piece.inlines.length > 0 || (i === 0 && breaks.length === 0));
    pieces.forEach((piece) => {
      if (piece.before !== null) breakPage(piece.before);
      if (!kept.includes(piece)) return;
      const k = kept.indexOf(piece);
      const parts = cutAtSplits(numberTexts(piece.inlines), splitsOf(measured, n, k));
      parts.forEach((part, i) => {
        const first = k === 0 && i === 0;
        const last = k === kept.length - 1 && i === parts.length - 1;
        const key = formatKey(i === 0 ? { kind: "piece", block: n, piece: k } : { kind: "continuation", block: n, piece: k, from: part.from });
        if (i === 0) measuredBreak(key);
        else newPage();
        const whole = breaks.length === 0 && parts.length === 1;
        emit(whole ? { ...p, inlines: part.inlines } : paragraphPiece(p, part.inlines, first, last), key);
      });
    });
  };

  const placeTable = (t: Table, n: number) => {
    const firstBody = t.rows.findIndex((row) => !row.isHeader);
    const head = firstBody === -1 ? [] : t.rows.slice(0, firstBody);
    // The first row of the vertically merged region each row is in: a break inside one moves up to it,
    // so no merged cell is cut.
    const mergeStart = t.rows.map((_, r) => r);
    t.rows.forEach((row, i) => {
      for (const cell of row.cells) {
        for (let k = i + 1; k < Math.min(i + cell.rowSpan, t.rows.length); k++) mergeStart[k] = Math.min(mergeStart[k], mergeStart[i]);
      }
    });
    let chunk: ResolvedRow[] = [];
    let start = 0;
    let repeated = 0;
    const flush = () => emit({ ...t, rows: chunk }, formatKey({ kind: "table", block: n, start, repeated }));
    const restart = (from: number, rows: readonly ResolvedRow[]) => {
      chunk = [...head, ...rows];
      start = from;
      repeated = head.length;
    };
    /** Breaks before row `r` (before its merged region), carrying the region's rows over; false when the
     *  page would keep no body row. */
    const breakAt = (r: number, rendered: boolean): boolean => {
      const target = mergeStart[r];
      const moved = r - target;
      if (target < start || chunk.length - moved <= head.length) return false;
      const carried = chunk.slice(chunk.length - moved);
      chunk = chunk.slice(0, chunk.length - moved);
      flush();
      if (rendered) breakPage("rendered");
      else newPage();
      restart(target, carried);
      return true;
    };
    measuredBreak(formatKey({ kind: "piece", block: n, piece: 0 }));
    t.rows.forEach((row, r) => {
      const merged = mergeStart[r] !== r || row.cells.some((cell) => cell.rowSpan > 1);
      const split = merged ? null : cellPages(row);
      if (split !== null && split.cells.some((groups) => groups.length > 1)) {
        if (split.startsPage && !breakAt(r, true) && chunk.length === 0) breakPage("rendered");
        rowPieces(row, split.cells).forEach((piece, p) => {
          if (p > 0) {
            flush();
            breakPage("rendered");
            restart(r, []);
          }
          chunk.push(piece);
        });
        return;
      }
      const rendered = row.cells.some((cell) => containsRenderedBreak(cell.blocks));
      const breaksHere = rendered || measured.has(formatKey({ kind: "row", block: n, row: r }));
      if (breaksHere && r >= head.length && breakAt(r, rendered)) {
        // broken before the row
      } else if (rendered && chunk.length === 0) {
        breakPage("rendered");
      }
      chunk.push(row);
    });
    flush();
  };

  let ordinal = 0;
  sections.forEach((s, i) => {
    section = i + 1;
    if (i === 0 || !s.continuous) {
      number++;
      if (s.pageNumberStart !== null) number = s.pageNumberStart;
      indexInSection = 0;
      pages.push({ section, indexInSection, number, parts: [draftPart(s.columns)], laidOut: false });
    } else {
      current().parts.push(draftPart(s.columns, (part().columns?.count ?? 1) > 1));
    }
    for (const block of s.body) {
      const n = ordinal++;
      if (block.kind === "paragraph") placeParagraph(block, n);
      else if (block.kind === "table") placeTable(block, n);
      else {
        const key = formatKey({ kind: "piece", block: n, piece: 0 });
        measuredBreak(key);
        emit(block, key);
      }
    }
    flushFloats();
  });
  if (pages.length > 1 && !hasContent(current())) pages.pop();
  return pages;
}

function footnoteNumbers(blocks: readonly ResolvedBlock[], out: Set<number>): Set<number> {
  const inInlines = (inlines: readonly ResolvedInline[]) => {
    for (const inline of inlines) {
      if (inline.kind === "footnoteRef") out.add(inline.n);
      else if (inline.kind === "link" || inline.kind === "anchor") inInlines(inline.inlines);
    }
  };
  for (const block of blocks) {
    if (block.kind === "paragraph") inInlines(block.inlines);
    else if (block.kind === "table") for (const row of block.rows) for (const cell of row.cells) footnoteNumbers(cell.blocks, out);
    else if (block.kind === "textbox") footnoteNumbers(block.blocks, out);
  }
  return out;
}

/** Each section's headers or footers with the types it lacks inherited from the section before. */
function inherited(sections: readonly ResolvedSection[], of: (s: ResolvedSection) => Stories): Stories[] {
  const out: Stories[] = [];
  sections.forEach((s, i) => out.push({ ...(i === 0 ? {} : out[i - 1]), ...of(s) }));
  return out;
}

export function paginate(
  sections: readonly ResolvedSection[],
  evenAndOddHeaders: boolean,
  measured: MeasuredBreaks = NO_BREAKS
): ResolvedPage[] {
  if (sections.length === 0) return [];
  const drafts = paginateSections(sections, measured);
  const headers = inherited(sections, (s) => s.headers);
  const footers = inherited(sections, (s) => s.footers);
  const notes = new Map(sections.flatMap((s) => s.footnotes.map((note) => [note.n, note] as const)));
  const pagesInSection = new Map<number, number>();
  for (const draft of drafts) pagesInSection.set(draft.section, (pagesInSection.get(draft.section) ?? 0) + 1);
  return drafts.map((draft): ResolvedPage => {
    const s = sections[draft.section - 1];
    const type = s.titlePage && draft.indexInSection === 0 ? "first" : evenAndOddHeaders && draft.number % 2 === 0 ? "even" : "default";
    const parts = draft.parts
      .filter((part, i) => i === 0 || part.blocks.length > 0)
      .map((part): ResolvedPart => ({
        columns: part.columns,
        blocks: part.blocks,
        keys: part.keys,
        columnStarts: part.columns === null || part.columnStarts.length === 0 ? null : [0, ...part.columnStarts],
      }));
    const referenced = new Set<number>();
    for (const part of parts) footnoteNumbers(part.blocks, referenced);
    return {
      path: s.path,
      widthPt: s.widthPt,
      heightPt: s.heightPt,
      marginsPt: s.marginsPt,
      number: formatNumber(draft.number, s.pageNumberFormat),
      laidOut: draft.laidOut,
      section: draft.section,
      sectionPages: pagesInSection.get(draft.section) ?? 1,
      header: headers[draft.section - 1][type] ?? [],
      parts,
      footnotes: [...referenced].sort((a, b) => a - b).flatMap((n) => notes.get(n) ?? []),
      footer: footers[draft.section - 1][type] ?? [],
    };
  });
}

/** The document as the pages Word lays it out on, with breaks found by measuring, if any. */
export function resolveDocument(document: DocumentNode, measured?: MeasuredBreaks): readonly ResolvedPage[] {
  return paginate(resolveSections(document), document.props.evenAndOddHeaderAndFooters ?? false, measured);
}
