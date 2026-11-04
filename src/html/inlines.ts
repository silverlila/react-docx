import type { ResolvedInline } from "./model";

export type ContainerInline = Extract<ResolvedInline, { kind: "link" | "anchor" }>;

export const isContainer = (inline: ResolvedInline): inline is ContainerInline =>
  inline.kind === "link" || inline.kind === "anchor";

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
