/** tabLayout: a paragraph's inline content cut at its tabs into boxes that put each piece of text where
 *  Word's tab stops put it, for the preview to draw without measuring text.
 *
 *  - A tab goes to the first stop past where the text before it ends (`wrappedStop` when the text wraps). That end is estimated from the
 *    text's length (ESTIMATED_EM per character, a full em for CJK); the estimate only picks the stop, and
 *    the boxes the browser lays out use the text's real width.
 *  - A left stop: the box holding the text before the tab is at least as wide as the distance to the stop,
 *    so the text after it starts there. A right stop: one box from the previous box's start to the stop
 *    holds the text before, the leader and the text after, right-aligned, so the text after ends at the
 *    stop. A center or decimal stop is drawn as a right stop past the stop by half the estimated text.
 *  - Positions are relative to the paragraph's left indent; the first line starts at the first-line
 *    indent. A hanging indent adds a stop at the left indent, as Word does. Bar stops place no text and
 *    are skipped.
 *  - Past the last stop, tabs go to the next multiple of the default tab stop (Word ignores default stops
 *    before a custom one). The browser places those itself: they stay tabs in the last span, drawn as tab
 *    characters with the default stop as the paragraph's tab-size.
 *  - A span is the last one when it has no width: it stays inline, and its text wraps. */

import type { ResolvedInline, TabStop } from "./model";

type Tab = Extract<ResolvedInline, { kind: "tab" }>;

/** A piece of a tabbed line: content, or the gap a tab leaves, with its leader and the tab's own run. */
export type TabItem =
  | { readonly kind: "content"; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "gap"; readonly tab: Tab; readonly leader: TabStop["leader"] };

/** widthPt: the span's width, at least (`exact` false) or exactly; null for the last span. */
type TabSpan = { readonly widthPt: number | null; readonly exact: boolean; readonly items: readonly TabItem[] };

type TabContext = {
  readonly stops: readonly TabStop[];
  /** Where the first line's text starts, relative to the left indent. */
  readonly startPt: number;
};

const ESTIMATED_EM = 0.5;
const WIDE = /[ᄀ-ᇿ⺀-꓏가-힯豈-﫿︰-﹏＀-｠￠-￦]/;
const MIN_GAP_PT = 0.5;

function estimatedWidth(inlines: readonly ResolvedInline[]): number {
  let width = 0;
  for (const inline of inlines) {
    if (inline.kind === "text" || inline.kind === "field") {
      const text = inline.kind === "text" ? inline.text : inline.placeholder;
      for (const char of text) width += inline.run.sizePt * (WIDE.test(char) ? 1 : ESTIMATED_EM);
    } else if (inline.kind === "link" || inline.kind === "anchor") {
      width += estimatedWidth(inline.inlines);
    } else if (inline.kind === "image") {
      width += inline.widthPx * 0.75;
    }
  }
  return width;
}

/** `inlines` cut at its tabs, top level and inside links and anchors: n + 1 segments around n tabs. */
function splitAtTabs(inlines: readonly ResolvedInline[]): { segments: ResolvedInline[][]; tabs: Tab[] } {
  const segments: ResolvedInline[][] = [[]];
  const tabs: Tab[] = [];
  const last = () => segments[segments.length - 1];
  for (const inline of inlines) {
    if (inline.kind === "tab") {
      tabs.push(inline);
      segments.push([]);
    } else if (inline.kind === "link" || inline.kind === "anchor") {
      const inner = splitAtTabs(inline.inlines);
      inner.segments.forEach((segment, i) => {
        if (i > 0) {
          tabs.push(inner.tabs[i - 1]);
          segments.push([]);
        }
        if (segment.length > 0) last().push({ ...inline, inlines: segment });
      });
    } else {
      last().push(inline);
    }
  }
  return { segments, tabs };
}

const nextStop = (at: number, context: TabContext): TabStop | undefined => context.stops.find((s) => s.posPt > at + MIN_GAP_PT);

/** Text that runs past every stop wraps, and a tab after it goes from the end of its last line: to the
 *  last right- or center-aligned stop, as a long table-of-contents entry's page number. */
function wrappedStop(at: number, context: TabContext): TabStop | undefined {
  const last = [...context.stops].reverse().find((s) => s.align !== "left");
  return last !== undefined && at > last.posPt && last.posPt > context.startPt ? last : undefined;
}

export const hasTabs = (inlines: readonly ResolvedInline[]): boolean => splitAtTabs(inlines).tabs.length > 0;

export function tabLayout(inlines: readonly ResolvedInline[], context: TabContext): TabSpan[] {
  const { segments, tabs } = splitAtTabs(inlines);
  const spans: TabSpan[] = [];
  let start = context.startPt;
  let items: TabItem[] = segments[0].length > 0 ? [{ kind: "content", inlines: segments[0] }] : [];
  let end = start + estimatedWidth(segments[0]);
  let literal = false;
  tabs.forEach((tab, i) => {
    const after = segments[i + 1];
    const stop = literal ? undefined : nextStop(end, context) ?? wrappedStop(end, context);
    if (stop === undefined) {
      literal = true;
      items.push({ kind: "content", inlines: [tab, ...after] });
      return;
    }
    const gap: TabItem = { kind: "gap", tab, leader: stop.leader };
    if (stop.align === "left") {
      spans.push({ widthPt: Math.max(0, stop.posPt - start), exact: false, items: [...items, gap] });
      start = stop.posPt;
      items = after.length > 0 ? [{ kind: "content", inlines: after }] : [];
      end = start + estimatedWidth(after);
      return;
    }
    const width = estimatedWidth(after);
    const right = stop.align === "right" ? stop.posPt : stop.posPt + width / 2;
    spans.push({
      widthPt: Math.max(0, right - start),
      exact: true,
      items: [...items, gap, ...(after.length > 0 ? [{ kind: "content" as const, inlines: after }] : [])],
    });
    start = right;
    items = [];
    end = right;
  });
  spans.push({ widthPt: null, exact: false, items });
  return spans;
}
