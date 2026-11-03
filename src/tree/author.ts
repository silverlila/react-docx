/** The authored tree's shapes and the error that names a place in it, shared by every module that reads it. */

/** The unnormalized `{ type, props, children }` the reconciler builds from JSX. */
export type AuthorNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (AuthorNode | string)[];
};

/** An authored child with its index among its parent's authored children, which names it in paths. */
export type IndexedChild = { readonly child: AuthorNode | string; readonly index: number };

export type PropBag = Readonly<Record<string, unknown>>;

export class TreeError extends Error {
  constructor(readonly path: readonly string[], message: string) {
    super(path.length === 0 ? message : `${path.join(" > ")}: ${message}`);
    this.name = "TreeError";
  }
}

export function isRecord(value: unknown): value is PropBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
