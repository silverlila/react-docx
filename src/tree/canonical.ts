import { DEFAULT_STYLE_SLOTS, PAGE_NUMBER_VALUES, PRESENCE_ONLY } from "../schema/docx-facts";
import { ELEMENTS, isKind, type DocumentNode, type Kind } from "../schema/elements";
import { LIST_NUMBERING, listEntries, listReference } from "./lists";

/** The unnormalized `{ type, props, children }` the reconciler builds from JSX. */
export type AuthorNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly (AuthorNode | string)[];
};

/** An authored child with its index among its parent's authored children, which names it in paths. */
export type IndexedChild = { readonly child: AuthorNode | string; readonly index: number };

export class TreeError extends Error {
  constructor(readonly path: readonly string[], message: string) {
    super(`${path.join(" > ")}: ${message}`);
    this.name = "TreeError";
  }
}

type PropBag = Readonly<Record<string, unknown>>;
/** A canonical node before its props are trusted as `Props<K>`: they are not validated, TSX type-checked them. */
type Built = { readonly type: Kind; readonly props: PropBag; readonly children: readonly (Built | string)[] };
type Context = { nextListInstance: number; listsExpanded: boolean };
type Parent = { readonly kind: Kind; readonly name: string; readonly path: readonly string[] };

const SUGAR: readonly string[] = ["List", "ListItem", "Break"];
const PAGE_NUMBERS: readonly string[] = PAGE_NUMBER_VALUES;
const STYLE_SLOTS = new Map(Object.entries(DEFAULT_STYLE_SLOTS));
const DATA_URL_PREFIX = /^data:[^,]*;base64,/;

/** The child a non-empty `text` prop becomes, inserted first. TextRun's `text` is handled in `textRuns`. */
const TEXT_PROP_CHILD: { readonly [K in Kind]?: (text: string) => Built } = {
  Paragraph: (text) => literalRun({}, text),
  Math: (text) => ({ type: "MathRun", props: {}, children: [text] }),
};

/** Per-kind prop rules. `children` is dropped from every kind before these run. */
const PROP_RULES: { readonly [K in Kind]?: (props: PropBag, path: readonly string[]) => PropBag } = {
  Document: foldDefaultStyles,
  Header: defaultHeaderFooterType,
  Footer: defaultHeaderFooterType,
  Paragraph: (props, path) => headingToStyle(omit(props, "text"), path),
  TextRun: (props) => omit(props, "text"),
  Math: (props) => omit(props, "text"),
  ImageRun: imageBytes,
};

/** Pure. Never mutates its input. canonicalize(canonicalize(x)) deep-equals canonicalize(x).
 *
 *  Invariant that makes it so: a canonical TextRun's `children` never contain a string equal to a
 *  PAGE_NUMBER_VALUES member, nor `""`, since a second pass would read the first as a field and drop the
 *  second. Such a literal lives in `props.text` of a TextRun of its own: no children, the same other props
 *  as the run it came from. `text` on a canonical TextRun appears only in that form. */
export function canonicalize(root: AuthorNode): DocumentNode {
  if (root.type !== "Document") {
    throw new TreeError([root.type], `The root must be <Document>, got <${root.type}>`);
  }
  const context: Context = { nextListInstance: 0, listsExpanded: false };
  const document = canonicalNode("Document", root, indexed(root.children), ["Document"], context);
  const props = context.listsExpanded ? withListNumbering(document.props) : document.props;
  // The placement checks enforce the child structure DocumentNode describes; props are trusted as authored.
  return { ...document, props } as DocumentNode;
}

function indexed(children: readonly (AuthorNode | string)[]): IndexedChild[] {
  return children.map((child, index) => ({ child, index }));
}

function childPath(path: readonly string[], child: AuthorNode, index: number): string[] {
  return [...path, `${child.type}[${index}]`];
}

function canonicalNode(
  kind: Kind,
  node: AuthorNode,
  content: readonly IndexedChild[],
  path: readonly string[],
  context: Context
): Built {
  if (kind === "Section") assertOneHeaderFooterPerType(content, path);
  const parent: Parent = { kind, name: node.type, path };
  return {
    type: kind,
    props: canonicalProps(kind, node.props, path),
    children: [...textPropChild(kind, node.props, path), ...canonicalChildren(parent, content, context)],
  };
}

/** A placed author node as canonical nodes: a TextRun may split into several at its Breaks. */
function nodesFor(kind: Kind, node: AuthorNode, path: readonly string[], context: Context): Built[] {
  if (kind === "TextRun") return textRuns(node, path, context);
  return [canonicalNode(kind, node, indexed(node.children), path, context)];
}

function isLegalIn(parent: Kind, type: string): type is Kind {
  const legal: readonly string[] = ELEMENTS[parent].children;
  return legal.includes(type);
}

/** The node's kind, once it is known and legal in `parent`. */
function placedKind(parent: Parent, node: AuthorNode, path: readonly string[]): Kind {
  if (!isKind(node.type) && !SUGAR.includes(node.type)) {
    throw new TreeError(path, `Unknown element <${node.type}>`);
  }
  if (isLegalIn(parent.kind, node.type)) return node.type;
  throw new TreeError(path, `<${node.type}> is not allowed in <${parent.name}>`);
}

function textNotAllowed(parent: Parent): TreeError {
  return new TreeError(parent.path, `Text is not allowed directly in <${parent.name}>`);
}

// ─── Children, by the kind of slot the parent is ───────────────────────────────

function canonicalChildren(parent: Parent, content: readonly IndexedChild[], context: Context): (Built | string)[] {
  if (ELEMENTS[parent.kind].text) return literalChildren(parent, content, context);
  if (isLegalIn(parent.kind, "Paragraph")) return blockChildren(parent, content, context);
  if (isLegalIn(parent.kind, "TextRun")) return inlineChildren(parent, content, context);
  if (isLegalIn(parent.kind, "MathRun")) return mathChildren(parent, content, context);
  return plainChildren(parent, content, context);
}

/** Section, Header, Footer, TableCell: Lists expand into paragraphs, a stray ListItem is a Paragraph. */
function blockChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return content.flatMap(({ child, index }) => {
    if (typeof child === "string") throw textNotAllowed(parent);
    const path = childPath(parent.path, child, index);
    if (child.type === "List") return listParagraphs(child, path, context);
    if (child.type === "ListItem") return [canonicalNode("Paragraph", child, indexed(child.children), path, context)];
    return nodesFor(placedKind(parent, child, path), child, path, context);
  });
}

/** Paragraph, hyperlinks, Bookmark: text, Breaks and run content standing here are wrapped in TextRuns. */
function inlineChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return groupChildren(content).flatMap((group): Built[] => {
    switch (group.kind) {
      case "text":
        return group.text === "" ? [] : [literalRun({}, group.text)];
      case "breaks":
        return [textRun({ break: group.count }, [])];
      case "node": {
        const { node, index } = group;
        const path = childPath(parent.path, node, index);
        if (!isLegalIn(parent.kind, node.type) && isLegalIn("TextRun", node.type)) {
          return [textRun({}, nodesFor(node.type, node, path, context))];
        }
        return nodesFor(placedKind(parent, node, path), node, path, context);
      }
    }
  });
}

/** Math: text standing here is wrapped in a MathRun. */
function mathChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return groupChildren(content).flatMap((group): Built[] => {
    switch (group.kind) {
      case "text":
        return group.text === "" ? [] : [{ type: "MathRun", props: {}, children: [group.text] }];
      case "breaks":
      case "node": {
        const { node, index } = group;
        const path = childPath(parent.path, node, index);
        return nodesFor(placedKind(parent, node, path), node, path, context);
      }
    }
  });
}

/** MathRun: strings are literal, merged, and empty ones dropped. */
function literalChildren(parent: Parent, content: readonly IndexedChild[], context: Context): (Built | string)[] {
  const items = content.flatMap(({ child, index }): (Built | string)[] => {
    if (typeof child === "string") return child === "" ? [] : [child];
    const path = childPath(parent.path, child, index);
    return nodesFor(placedKind(parent, child, path), child, path, context);
  });
  return mergeStrings(items);
}

/** Document, Table, TableRow and leaf kinds: element children only. */
function plainChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return content.flatMap(({ child, index }) => {
    if (typeof child === "string") throw textNotAllowed(parent);
    const path = childPath(parent.path, child, index);
    return nodesFor(placedKind(parent, child, path), child, path, context);
  });
}

type Group =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "breaks"; readonly count: number; readonly node: AuthorNode; readonly index: number }
  | { readonly kind: "node"; readonly node: AuthorNode; readonly index: number };

/** Consecutive strings merge into one text group and consecutive Breaks into one breaks group,
 *  which keeps its first Break for error paths. */
function groupChildren(content: readonly IndexedChild[]): Group[] {
  const groups: Group[] = [];
  for (const { child, index } of content) {
    const last: Group | undefined = groups[groups.length - 1];
    if (typeof child === "string") {
      if (last?.kind === "text") groups[groups.length - 1] = { kind: "text", text: last.text + child };
      else groups.push({ kind: "text", text: child });
    } else if (child.type === "Break") {
      if (last?.kind === "breaks") groups[groups.length - 1] = { ...last, count: last.count + 1 };
      else groups.push({ kind: "breaks", count: 1, node: child, index });
    } else {
      groups.push({ kind: "node", node: child, index });
    }
  }
  return groups;
}

function textRun(props: PropBag, children: readonly (Built | string)[]): Built {
  return { type: "TextRun", props, children };
}

/** A literal a second pass would reinterpret as a run child: a PageNumber value becomes a field, `""` is dropped. */
function isProtected(text: string): boolean {
  return text === "" || PAGE_NUMBERS.includes(text);
}

/** A run holding the literal `text`: as `props.text` when it is protected, as its only child otherwise. */
function literalRun(props: PropBag, text: string): Built {
  return isProtected(text) ? textRun({ ...props, text }, []) : textRun(props, [text]);
}

function mergeStrings<T>(items: readonly (T | string)[]): (T | string)[] {
  const merged: (T | string)[] = [];
  for (const item of items) {
    const last: T | string | undefined = merged[merged.length - 1];
    if (typeof item === "string" && typeof last === "string") merged[merged.length - 1] = last + item;
    else merged.push(item);
  }
  return merged;
}

// ─── TextRun: fields, the text prop, and splitting at Breaks ───────────────────

const BREAK: unique symbol = Symbol("Break");
/** A protected literal, which never merges with its neighbours and is written as a `text` run of its own. */
type Literal = { readonly literal: string };
type SegmentItem = Built | string | Literal;
type RunItem = SegmentItem | typeof BREAK;
type Segment = { breaks: number; content: SegmentItem[] };

function textRuns(node: AuthorNode, path: readonly string[], context: Context): Built[] {
  const parent: Parent = { kind: "TextRun", name: node.type, path };
  const props = canonicalProps("TextRun", node.props, path);
  const text = textProp(node.props, path);
  const items: RunItem[] = text === undefined ? [] : [isProtected(text) ? { literal: text } : text];
  for (const { child, index } of indexed(node.children)) {
    if (typeof child === "string") {
      if (child !== "") items.push(PAGE_NUMBERS.includes(child) ? pageNumber(child) : child);
    } else if (child.type === "Break") {
      items.push(BREAK);
    } else {
      const childAt = childPath(path, child, index);
      items.push(...nodesFor(placedKind(parent, child, childAt), child, childAt, context));
    }
  }
  return segmentsAtBreaks(items).flatMap((segment, i) => segmentRuns(segmentProps(props, segment, i === 0), segment));
}

function isLiteral(item: SegmentItem): item is Literal {
  return typeof item === "object" && "literal" in item;
}

/** A segment's runs. Adjacent strings merge first, and a merged string that is protected becomes a Literal.
 *  Each Literal is a `text` run of its own; the content between Literals shares a run. Only the first run
 *  keeps the segment's `break`, so `break` still counts only the Breaks that lead the content. */
function segmentRuns(props: PropBag, segment: Segment): Built[] {
  const content = mergeStrings(segment.content).map((item) =>
    typeof item === "string" && isProtected(item) ? { literal: item } : item
  );
  const chunks: (Literal | (Built | string)[])[] = [];
  for (const item of content) {
    const last = chunks[chunks.length - 1];
    if (isLiteral(item)) chunks.push(item);
    else if (Array.isArray(last)) last.push(item);
    else chunks.push([item]);
  }
  if (chunks.length === 0) return [textRun(props, [])];
  return chunks.map((chunk, i) => {
    const runProps = i === 0 ? props : omit(props, "break");
    return Array.isArray(chunk) ? textRun(runProps, chunk) : textRun({ ...runProps, text: chunk.literal }, []);
  });
}

function pageNumber(field: string): Built {
  return { type: "PageNumber", props: { field }, children: [] };
}

/** The first segment holds the content before any Break, plus the Breaks that precede all content.
 *  Each later segment holds the content after a run of consecutive Breaks. */
function segmentsAtBreaks(items: readonly RunItem[]): Segment[] {
  const segments: Segment[] = [{ breaks: 0, content: [] }];
  for (const item of items) {
    const last = segments[segments.length - 1];
    if (item !== BREAK) last.content.push(item);
    else if (last.content.length === 0) last.breaks += 1;
    else segments.push({ breaks: 1, content: [] });
  }
  return segments;
}

function segmentProps(props: PropBag, segment: Segment, first: boolean): PropBag {
  if (!first) return { ...props, break: segment.breaks };
  if (segment.breaks === 0) return props;
  const leading = typeof props.break === "number" ? props.break : 0;
  return { ...props, break: leading + segment.breaks };
}

// ─── Props ─────────────────────────────────────────────────────────────────────

function canonicalProps(kind: Kind, props: PropBag, path: readonly string[]): PropBag {
  const own = omit(props, "children");
  const rule = PROP_RULES[kind];
  return withoutPresenceOnlyFalse(kind, rule ? rule(own, path) : own);
}

function omit(props: PropBag, ...keys: string[]): PropBag {
  const rest = { ...props };
  for (const key of keys) delete rest[key];
  return rest;
}

function isRecord(value: unknown): value is PropBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textProp(props: PropBag, path: readonly string[]): string | undefined {
  const { text } = props;
  if (text === undefined || typeof text === "string") return text;
  throw new TreeError(path, `text must be a string, got ${typeof text}`);
}

/** docx.js ignores an empty Paragraph `text` (`if (options.text)`), so an empty one inserts nothing. */
function textPropChild(kind: Kind, props: PropBag, path: readonly string[]): Built[] {
  const child = TEXT_PROP_CHILD[kind];
  const text = textProp(props, path);
  if (child === undefined || text === undefined || text === "") return [];
  return [child(text)];
}

function headingToStyle(props: PropBag, path: readonly string[]): PropBag {
  const { heading, ...rest } = props;
  if (heading === undefined) return rest;
  if (rest.style === undefined) return { ...rest, style: heading };
  if (rest.style === heading) return rest;
  throw new TreeError(path, `heading="${heading}" and style="${rest.style}" conflict; use one`);
}

function defaultHeaderFooterType(props: PropBag): PropBag {
  return { ...props, type: props.type ?? "default" };
}

function assertOneHeaderFooterPerType(content: readonly IndexedChild[], path: readonly string[]): void {
  const seen = new Set<string>();
  for (const { child, index } of content) {
    if (typeof child === "string" || (child.type !== "Header" && child.type !== "Footer")) continue;
    const type = child.props.type ?? "default";
    const key = `${child.type} ${type}`;
    if (seen.has(key)) {
      throw new TreeError(childPath(path, child, index), `A second <${child.type} type="${type}"> in one <Section>`);
    }
    seen.add(key);
  }
}

function withoutPresenceOnlyFalse(kind: Kind, props: PropBag): PropBag {
  return (PRESENCE_ONLY[kind] ?? []).reduce((current, path) => withoutFalseAt(current, path.split(".")), props);
}

/** Removes the value at a dot path when it is `false`; a parent object left empty stays. */
function withoutFalseAt(props: PropBag, [key, ...rest]: readonly string[]): PropBag {
  const value = props[key];
  if (rest.length === 0) return value === false ? omit(props, key) : props;
  return isRecord(value) ? { ...props, [key]: withoutFalseAt(value, rest) } : props;
}

function imageBytes(props: PropBag, path: readonly string[]): PropBag {
  const { fallback } = props;
  return {
    ...props,
    data: bytes(props.data, path),
    ...(isRecord(fallback) ? { fallback: { ...fallback, data: bytes(fallback.data, path) } } : {}),
  };
}

/** Base64 (optionally a data URL) is decoded with `atob`, never Node's Buffer: this runs in browsers too. */
function bytes(data: unknown, path: readonly string[]): Uint8Array {
  if (typeof data === "string") {
    return Uint8Array.from(atob(data.replace(DATA_URL_PREFIX, "")), (char) => char.charCodeAt(0));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data.constructor === Uint8Array ? data : new Uint8Array(data);
  throw new TreeError(path, "ImageRun data must be a base64 string, an ArrayBuffer or a Uint8Array");
}

// ─── Document: style folding and list numbering ────────────────────────────────

type StyleList = "paragraphStyles" | "characterStyles";
const STYLE_LIST_KIND = { paragraphStyles: "paragraph", characterStyles: "character" } as const;

/** Entries whose id is one of docx.js's built-in style ids move into `styles.default.<key>`, without
 *  their id, so the written styles.xml holds one definition of that id instead of two. */
function foldDefaultStyles(props: PropBag, path: readonly string[]): PropBag {
  if (!isRecord(props.styles)) return props;
  const { paragraphStyles, characterStyles, ...styles } = props.styles;
  const paragraphs = partitionStyles("paragraphStyles", paragraphStyles, path);
  const characters = partitionStyles("characterStyles", characterStyles, path);
  const folded = { ...paragraphs.defaults, ...characters.defaults };
  const defaults = isRecord(styles.default) ? styles.default : {};
  return {
    ...props,
    styles: {
      ...styles,
      ...(Object.keys(folded).length > 0 ? { default: { ...defaults, ...folded } } : {}),
      ...(paragraphs.custom.length > 0 ? { paragraphStyles: paragraphs.custom } : {}),
      ...(characters.custom.length > 0 ? { characterStyles: characters.custom } : {}),
    },
  };
}

function partitionStyles(
  list: StyleList,
  entries: unknown,
  path: readonly string[]
): { custom: unknown[]; defaults: Record<string, unknown> } {
  const authored = entries ?? [];
  if (!Array.isArray(authored)) throw new TreeError(path, `styles.${list} must be an array`);
  const styles: readonly unknown[] = authored;
  const custom: unknown[] = [];
  const defaults: Record<string, unknown> = {};
  for (const entry of styles) {
    const slot = isRecord(entry) && typeof entry.id === "string" ? STYLE_SLOTS.get(entry.id) : undefined;
    if (!isRecord(entry) || slot === undefined) {
      custom.push(entry);
      continue;
    }
    if (slot.kind !== STYLE_LIST_KIND[list]) {
      throw new TreeError(path, `styles.${list} entry "${entry.id}" is docx.js's built-in ${slot.kind} style`);
    }
    const { id: _id, ...definition } = entry;
    defaults[slot.key] = definition;
  }
  return { custom, defaults };
}

function listParagraphs(list: AuthorNode, path: readonly string[], context: Context): Built[] {
  const reference = listReference(list);
  const instance = context.nextListInstance++;
  context.listsExpanded = true;
  return listEntries(list, path).map((entry) => {
    const paragraph = canonicalNode("Paragraph", entry.item, entry.content, entry.path, context);
    return { ...paragraph, props: { ...paragraph.props, numbering: { reference, level: entry.level, instance } } };
  });
}

/** Adds each LIST_NUMBERING config whose reference the document does not already configure. */
function withListNumbering(props: PropBag): PropBag {
  const numbering = isRecord(props.numbering) ? props.numbering : {};
  const config: unknown[] = Array.isArray(numbering.config) ? numbering.config : [];
  const configured = new Set(config.map((entry) => (isRecord(entry) ? entry.reference : undefined)));
  const missing = LIST_NUMBERING.config.filter((entry) => !configured.has(entry.reference));
  if (missing.length === 0) return props;
  return { ...props, numbering: { ...numbering, config: [...config, ...missing] } };
}
