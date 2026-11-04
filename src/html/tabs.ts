/** tabLayout: a paragraph's inline content cut at its tabs into boxes that put each piece of text where
 *  Word's tab stops put it, for the preview to draw without measuring text.
 *
 *  Word's tab rules it follows: a hanging indent adds a stop at the left indent; bar stops place no text;
 *  default stops before a custom one are ignored; text that runs past every stop wraps, and a tab after
 *  it goes to the last right- or center-aligned stop, as a long table-of-contents entry's page number. */

import { cutInlines, isContainer } from "./inlines";
import type { ResolvedInline, TabStop } from "./model";

type Tab = Extract<ResolvedInline, { kind: "tab" }>;

export type TabItem =
  | { readonly kind: "content"; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "gap"; readonly tab: Tab; readonly leader: TabStop["leader"] };

type TabSpan = { readonly widthPt: number | null; readonly exact: boolean; readonly items: readonly TabItem[] };

type TabContext = {
  readonly stops: readonly TabStop[];
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
    } else if (isContainer(inline)) {
      width += estimatedWidth(inline.inlines);
    } else if (inline.kind === "image") {
      width += inline.widthPx * 0.75;
    }
  }
  return width;
}

const tabOf = (inline: ResolvedInline): Tab | null => (inline.kind === "tab" ? inline : null);

const nextStop = (at: number, context: TabContext): TabStop | undefined => context.stops.find((s) => s.posPt > at + MIN_GAP_PT);

function wrappedStop(at: number, context: TabContext): TabStop | undefined {
  const last = [...context.stops].reverse().find((s) => s.align !== "left");
  return last !== undefined && at > last.posPt && last.posPt > context.startPt ? last : undefined;
}

export const hasTabs = (inlines: readonly ResolvedInline[]): boolean => cutInlines(inlines, tabOf).cuts.length > 0;

export function tabLayout(inlines: readonly ResolvedInline[], context: TabContext): TabSpan[] {
  const { segments, cuts: tabs } = cutInlines(inlines, tabOf);
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
