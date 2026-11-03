import type { AuthorNode } from "../../src/tree/author";

/** Builds an AuthorNode the way the reconciler will: `n("Paragraph", { style: "x" }, "text", n("Tab"))`. */
export function n(
  type: string,
  props: Readonly<Record<string, unknown>> = {},
  ...children: (AuthorNode | string)[]
): AuthorNode {
  return { type, props, children };
}
