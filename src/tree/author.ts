export type AuthorNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (AuthorNode | string)[];
};

export type IndexedChild = { readonly child: AuthorNode | string; readonly index: number };

export type PropBag = Readonly<Record<string, unknown>>;

export const node = (type: string, props: PropBag = {}, children: AuthorNode["children"] = []): AuthorNode => ({
  type,
  props,
  children,
});

export class TreeError extends Error {
  constructor(
    readonly path: readonly string[],
    message: string,
  ) {
    super(path.length === 0 ? message : `${path.join(" > ")}: ${message}`);
    this.name = "TreeError";
  }
}

export function isRecord(value: unknown): value is PropBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
