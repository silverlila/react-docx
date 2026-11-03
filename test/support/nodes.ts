import type { AuthorNode } from "../../src/tree/author";

export function n(
  type: string,
  props: Readonly<Record<string, unknown>> = {},
  ...children: (AuthorNode | string)[]
): AuthorNode {
  return { type, props, children };
}
