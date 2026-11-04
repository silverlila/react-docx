/** Word writes a deleted run's text as w:delText and w:delInstrText. A move is written as a deletion plus
 *  an insertion, with range marks (w:move*RangeStart/End) that carry no content. */

import { isOwnKey } from "../schema/own";
import type { ReadContext } from "./context";
import { attrOf, elementsOf, type XmlElement } from "../ooxml/xml";

type ChangeKind = "InsertedTextRun" | "DeletedTextRun";

type TrackedRuns = {
  readonly kind: ChangeKind;
  readonly props: Readonly<Record<string, unknown>>;
  readonly runs: readonly XmlElement[];
};

const CHANGES: Readonly<Record<string, { readonly kind: ChangeKind; readonly moved: boolean }>> = {
  "w:ins": { kind: "InsertedTextRun", moved: false },
  "w:moveTo": { kind: "InsertedTextRun", moved: true },
  "w:del": { kind: "DeletedTextRun", moved: false },
  "w:moveFrom": { kind: "DeletedTextRun", moved: true },
};

export const MOVE_RANGES: ReadonlySet<string> = new Set([
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
]);

const DELETED_AS_LIVE: Readonly<Record<string, string>> = { "w:delText": "w:t", "w:delInstrText": "w:instrText" };

export const isChange = (name: string): boolean => isOwnKey(CHANGES, name);

export const isDeletion = (name: string): boolean => isChange(name) && CHANGES[name].kind === "DeletedTextRun";

function asLive(run: XmlElement): XmlElement {
  const children = run.children.map((child) =>
    typeof child !== "string" && isOwnKey(DELETED_AS_LIVE, child.name)
      ? { ...child, name: DELETED_AS_LIVE[child.name] }
      : child
  );
  return { ...run, children };
}

export function trackedRuns(el: XmlElement, ctx: ReadContext): TrackedRuns | null {
  const { kind, moved } = CHANGES[el.name];
  const runs = elementsOf(el);
  if (runs.some((run) => run.name !== "w:r")) return null;
  if (moved) ctx.report({ kind: "resolved", element: el.name, detail: "move shown as insert/delete" });
  const author = attrOf(el, "w:author");
  const date = attrOf(el, "w:date");
  const props = {
    id: ctx.ordinals("change", attrOf(el, "w:id") ?? ""),
    ...(author === null ? {} : { author }),
    ...(date === null ? {} : { date }),
  };
  return { kind, props, runs: kind === "DeletedTextRun" ? runs.map(asLive) : runs };
}
