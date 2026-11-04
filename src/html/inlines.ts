/** Walks over a paragraph's resolved inlines, shared by paginate (pages.ts) and tabLayout (tabs.ts). Links
 *  and anchors are the inlines that hold inlines: a walk goes into them, and a cut through one leaves a copy
 *  of it around each part of its content. */

import type { ResolvedInline } from "./model";

export type ContainerInline = Extract<ResolvedInline, { kind: "link" | "anchor" }>;

export const isContainer = (inline: ResolvedInline): inline is ContainerInline =>
  inline.kind === "link" || inline.kind === "anchor";

/** `inlines` cut at each inline that `cutOf` turns into a cut, top level and inside links and anchors:
 *  n + 1 segments around n cuts. */
export function cutInlines<C>(
  inlines: readonly ResolvedInline[],
  cutOf: (inline: ResolvedInline) => C | null,
): { segments: ResolvedInline[][]; cuts: C[] } {
  const segments: ResolvedInline[][] = [[]];
  const cuts: C[] = [];
  const last = () => segments[segments.length - 1];
  for (const inline of inlines) {
    const cut = cutOf(inline);
    if (cut !== null) {
      cuts.push(cut);
      segments.push([]);
    } else if (isContainer(inline)) {
      const inner = cutInlines(inline.inlines, cutOf);
      inner.segments.forEach((segment, i) => {
        if (i > 0) {
          cuts.push(inner.cuts[i - 1]);
          segments.push([]);
        }
        if (segment.length > 0) last().push({ ...inline, inlines: segment });
      });
    } else {
      last().push(inline);
    }
  }
  return { segments, cuts };
}
