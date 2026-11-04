/** canonicalize turns an authored tree into its one checked canonical form, or throws a TreeError naming
 *  where the tree is wrong.
 *
 *  OOXML and docx.js facts it relies on:
 *  - Only relationship attributes (r:id, r:embed, …) use the r: namespace, so a regex finds them.
 *    docx.js cannot write their targets from raw XML, so a fragment holding one is rejected.
 *  - w:txbxContent must hold at least one block. Word writes an empty text box as one empty paragraph.
 *  - docx.js appends an empty `<w:p/>` after a table cell's last child unless it is its own Paragraph,
 *    so a cell ending in a raw `<w:p>` is rejected.
 *  - docx.js puts a footnote's number mark at the front of its first child, which must be a Paragraph:
 *    a leading Table crashes it, and an empty Footnote shows no number.
 *  - docx.js ignores an empty Paragraph `text` (`if (options.text)`).
 *  - docx.js writes its built-in style ids itself, so an authored style with one of those ids folds into
 *    `styles.default.<key>`. Otherwise styles.xml would define it twice.
 *  - docx.js writes raw styles after its own, so a raw w:styleId that is already defined, or defined by
 *    an earlier raw style, is rejected: it would be defined twice. */

import { DEFAULT_STYLE_SLOTS, PAGE_NUMBER_VALUES, RAW_XML_ROOTS } from "../schema/docx-facts";
import {
  ELEMENTS,
  OUTSIDE_BODY,
  isKind,
  type ChildKind,
  type Content,
  type DocumentNode,
  type Kind,
} from "../schema/elements";
import { TreeError, isRecord, type AuthorNode, type IndexedChild, type PropBag } from "./author";
import { LIST_NUMBERING, listEntries, listLevels, numberingConfig, type ListEntry, type ListLevels } from "./lists";
import { xmlRoots } from "./xml-roots";

type Built = { readonly type: Kind; readonly props: PropBag; readonly children: readonly (Built | string)[] };
type DocumentState = {
  nextListInstance: number;
  readonly listDefinitions: Map<string, ListEntry["definition"]>;
  readonly listLevels: ListLevels;
  readonly commentIds: Set<unknown>;
  readonly commentMarks: { readonly id: unknown; readonly path: readonly string[] }[];
};
type Context = {
  readonly document: DocumentState;
  readonly outsideBody: boolean;
};
type Parent<K extends Kind = Kind> = { readonly kind: K; readonly name: string; readonly path: readonly string[] };
type RunKind = { [K in Kind]: (typeof ELEMENTS)[K]["content"] extends "run" ? K : never }[Kind];
type UnsplitKind = Exclude<Kind, RunKind>;

const SUGAR: readonly string[] = ["List", "ListItem", "Break"];
const PAGE_NUMBERS: readonly string[] = PAGE_NUMBER_VALUES;
const STYLE_SLOTS = new Map(Object.entries(DEFAULT_STYLE_SLOTS));
const DATA_URL_PREFIX = /^data:[^,]*;base64,/;
const STYLE_ID = /w:styleId="([^"]+)"/g;
const COMMENT_MARKS: readonly Kind[] = ["CommentRangeStart", "CommentRangeEnd", "CommentReference"];
const LOOSE_PARAGRAPH: AuthorNode = { type: "Paragraph", props: {}, children: [] };

const RAW_XML_SLOT: { readonly [C in Content]?: Exclude<keyof typeof RAW_XML_ROOTS, "style"> } = {
  block: "block",
  inline: "inline",
  run: "run",
};

const TEXT_PROP_CHILD: { readonly [K in Kind]?: (text: string) => Built } = {
  Paragraph: (text) => literalRun({}, text),
  Math: (text) => ({ type: "MathRun", props: {}, children: [text] }),
};

const IMPORTED_STYLES = "use styles.importedStyles, XML strings of <w:style> elements";

const REMOVED_PROPS: { readonly [K in Kind]?: Readonly<Record<string, string>> } = {
  Document: {
    footnotes: "put a <Footnote> in the paragraph where its number goes",
    comments: "put <Comment> elements directly in the <Document>",
    externalStyles: IMPORTED_STYLES,
  },
  Section: { headers: "use <Header> children", footers: "use <Footer> children" },
};

function assertNoRemovedProps(kind: Kind, props: PropBag, path: readonly string[]): void {
  for (const [prop, replacement] of Object.entries(REMOVED_PROPS[kind] ?? {})) {
    if (props[prop] !== undefined) throw new TreeError(path, `${kind}.${prop} was removed: ${replacement}`);
  }
  if (kind === "Document" && isRecord(props.styles) && props.styles.initialStyles !== undefined) {
    throw new TreeError(path, `styles.initialStyles was removed: ${IMPORTED_STYLES}`);
  }
}

const PROP_RULES: { readonly [K in Kind]?: (props: PropBag, path: readonly string[]) => PropBag } = {
  Document: (props, path) => assertImportedStyles(foldDefaultStyles(props, path), path),
  Header: defaultHeaderFooterType,
  Footer: defaultHeaderFooterType,
  Paragraph: (props, path) => headingToStyle(omit(props, "text"), path),
  TextRun: (props) => omit(props, "text"),
  InsertedTextRun: (props) => omit(props, "text"),
  DeletedTextRun: (props) => omit(props, "text"),
  Math: (props) => omit(props, "text"),
  ImageRun: imageBytes,
};

export function canonicalize(root: AuthorNode): DocumentNode {
  if (root.type !== "Document") {
    throw new TreeError([root.type], `The root must be <Document>, got <${root.type}>`);
  }
  const numbering = numberingConfig(root.props.numbering, ["Document"]);
  const state: DocumentState = {
    nextListInstance: 0,
    listDefinitions: new Map(),
    listLevels: listLevels(numbering),
    commentIds: new Set(),
    commentMarks: [],
  };
  const document = canonicalNode("Document", root, indexed(root.children), ["Document"], {
    document: state,
    outsideBody: false,
  });
  assertCommentIdsResolve(state);
  const props =
    state.listDefinitions.size > 0 ? withListNumbering(document.props, numbering, state.listDefinitions) : document.props;
  return { ...document, props } as DocumentNode;
}

function emptyParagraph(): Built {
  return { type: "Paragraph", props: {}, children: [] };
}

function indexed(children: readonly (AuthorNode | string)[]): IndexedChild[] {
  return children.map((child, index) => ({ child, index }));
}

function childPath(path: readonly string[], child: AuthorNode, index: number): string[] {
  return [...path, `${child.type}[${index}]`];
}

function canonicalNode(
  kind: UnsplitKind,
  node: AuthorNode,
  content: readonly IndexedChild[],
  path: readonly string[],
  context: Context
): Built {
  if (kind === "Section") assertOneHeaderFooterPerType(content, path);
  if (kind === "Footnote" && context.outsideBody) {
    throw new TreeError(path, "Footnote is only allowed in the document body");
  }
  recordCommentId(kind, node.props, path, context.document);
  const parent: Parent<UnsplitKind> = { kind, name: node.type, path };
  const inner = OUTSIDE_BODY.includes(kind) ? { ...context, outsideBody: true } : context;
  const authored = [...textPropChild(kind, node.props, path), ...canonicalChildren(parent, content, inner)];
  const children = kind === "Textbox" && authored.length === 0 ? [emptyParagraph()] : authored;
  if (kind === "TableCell") assertCellEndsWithParagraph(children, path);
  if (kind === "Footnote") assertFootnoteStartsWithParagraph(children, path);
  return { type: kind, props: canonicalProps(kind, node.props, path), children };
}

function nodesFor(parent: Parent, kind: Kind, node: AuthorNode, path: readonly string[], context: Context): Built[] {
  if (isRunKind(kind)) return runs(kind, node, path, context);
  if (kind === "RawXml") assertRawXmlFits(parent, node, path);
  return [canonicalNode(kind, node, indexed(node.children), path, context)];
}

function isRunKind(kind: Kind): kind is RunKind {
  return ELEMENTS[kind].content === "run";
}

function isLegalIn<P extends Kind>(parent: P, type: string): type is ChildKind<P> {
  const legal: readonly string[] = ELEMENTS[parent].children;
  return legal.includes(type);
}

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

function canonicalChildren(
  parent: Parent<UnsplitKind>,
  content: readonly IndexedChild[],
  context: Context
): (Built | string)[] {
  switch (ELEMENTS[parent.kind].content) {
    case "block":
      return blockChildren(parent, content, context);
    case "wrapped":
      return wrappedBlockChildren(parent, content, context);
    case "inline":
      return inlineChildren(parent, content, context);
    case "math":
      return mathChildren(parent, content, context);
    case "literal":
      return literalChildren(parent, content, context);
    case "plain":
      return plainChildren(parent, content, context);
  }
}

function blockChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return content.flatMap(({ child, index }) => {
    if (typeof child === "string") throw textNotAllowed(parent);
    const path = childPath(parent.path, child, index);
    if (child.type === "List") return listParagraphs(child, path, context);
    if (child.type === "ListItem") return [canonicalNode("Paragraph", child, indexed(child.children), path, context)];
    return nodesFor(parent, placedKind(parent, child, path), child, path, context);
  });
}

function wrappedBlockChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return looseRuns(parent.kind, content).flatMap((group) =>
    group.loose
      ? [canonicalNode("Paragraph", LOOSE_PARAGRAPH, group.content, parent.path, context)]
      : blockChildren(parent, group.content, context)
  );
}

function looseRuns(parent: Kind, content: readonly IndexedChild[]): { loose: boolean; content: IndexedChild[] }[] {
  const groups: { loose: boolean; content: IndexedChild[] }[] = [];
  for (const item of content) {
    const loose = isLoose(parent, item.child);
    const last = groups[groups.length - 1];
    if (last?.loose === loose) last.content.push(item);
    else groups.push({ loose, content: [item] });
  }
  return groups;
}

function isLoose(parent: Kind, child: AuthorNode | string): boolean {
  if (typeof child === "string") return true;
  if (isLegalIn(parent, child.type)) return false;
  return child.type === "Break" || isLegalIn("Paragraph", child.type) || isLegalIn("TextRun", child.type);
}

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
          return [textRun({}, [canonicalNode(node.type, node, indexed(node.children), path, context)])];
        }
        return nodesFor(parent, placedKind(parent, node, path), node, path, context);
      }
    }
  });
}

function mathChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return groupChildren(content).flatMap((group): Built[] => {
    switch (group.kind) {
      case "text":
        return group.text === "" ? [] : [{ type: "MathRun", props: {}, children: [group.text] }];
      case "breaks":
      case "node": {
        const { node, index } = group;
        const path = childPath(parent.path, node, index);
        return nodesFor(parent, placedKind(parent, node, path), node, path, context);
      }
    }
  });
}

function literalChildren(parent: Parent, content: readonly IndexedChild[], context: Context): (Built | string)[] {
  const items = content.flatMap(({ child, index }): (Built | string)[] => {
    if (typeof child === "string") return child === "" ? [] : [child];
    const path = childPath(parent.path, child, index);
    return nodesFor(parent, placedKind(parent, child, path), child, path, context);
  });
  return mergeStrings(items);
}

function plainChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return content.flatMap(({ child, index }) => {
    if (typeof child === "string") throw textNotAllowed(parent);
    const path = childPath(parent.path, child, index);
    return nodesFor(parent, placedKind(parent, child, path), child, path, context);
  });
}

type Group =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "breaks"; readonly count: number; readonly node: AuthorNode; readonly index: number }
  | { readonly kind: "node"; readonly node: AuthorNode; readonly index: number };

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
  return run("TextRun", props, children);
}

function run(kind: RunKind, props: PropBag, children: readonly (Built | string)[]): Built {
  return { type: kind, props, children };
}

function isProtected(text: string): boolean {
  return text === "" || PAGE_NUMBERS.includes(text);
}

function literalRun(props: PropBag, text: string): Built {
  return isProtected(text) ? textRun({ ...props, text }, []) : textRun(props, [text]);
}

export function mergeStrings<T>(items: readonly (T | string)[]): (T | string)[] {
  const merged: (T | string)[] = [];
  for (const item of items) {
    const last: T | string | undefined = merged[merged.length - 1];
    if (typeof item === "string" && typeof last === "string") merged[merged.length - 1] = last + item;
    else merged.push(item);
  }
  return merged;
}

const BREAK: unique symbol = Symbol("Break");
type Literal = { readonly literal: string };
type SegmentItem = Built | string | Literal;
type RunItem = SegmentItem | typeof BREAK;
type Segment = { breaks: number; content: SegmentItem[] };

function runs(kind: RunKind, node: AuthorNode, path: readonly string[], context: Context): Built[] {
  const parent: Parent = { kind, name: node.type, path };
  const props = canonicalProps(kind, node.props, path);
  const text = textProp(node.props, path);
  const items: RunItem[] = text === undefined ? [] : [isProtected(text) ? { literal: text } : text];
  for (const { child, index } of indexed(node.children)) {
    if (typeof child === "string") {
      if (child !== "") items.push(PAGE_NUMBERS.includes(child) ? pageNumber(child) : child);
    } else if (child.type === "Break") {
      items.push(BREAK);
    } else {
      const childAt = childPath(path, child, index);
      items.push(...nodesFor(parent, placedKind(parent, child, childAt), child, childAt, context));
    }
  }
  return segmentsAtBreaks(items).flatMap((segment, i) =>
    segmentRuns(kind, segmentProps(props, segment, i === 0), segment)
  );
}

function isLiteral(item: SegmentItem): item is Literal {
  return typeof item === "object" && "literal" in item;
}

function segmentRuns(kind: RunKind, props: PropBag, segment: Segment): Built[] {
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
  if (chunks.length === 0) return [run(kind, props, [])];
  return chunks.map((chunk, i) => {
    const runProps = i === 0 ? props : omit(props, "break");
    return Array.isArray(chunk) ? run(kind, runProps, chunk) : run(kind, { ...runProps, text: chunk.literal }, []);
  });
}

function pageNumber(field: string): Built {
  return { type: "PageNumber", props: { field }, children: [] };
}

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

type Fragment = {
  readonly xml: string;
  readonly label: string;
  readonly allowedRoots: readonly string[];
  readonly where: string;
};

function assertFragment({ xml, label, allowedRoots, where }: Fragment, path: readonly string[]): void {
  if (!xml.includes("<")) throw new TreeError(path, `${label} must contain at least one element`);
  const scanned = xmlRoots(xml);
  if (scanned.kind === "malformed") throw new TreeError(path, `${label} is not well-formed: ${scanned.reason}`);
  if (scanned.kind === "unwritable") throw new TreeError(path, `${label} cannot be written: ${scanned.reason}`);
  if (scanned.kind === "relationship") {
    throw new TreeError(
      path,
      `${label} cannot carry relationship references (r:id, r:embed, …): docx.js cannot write their targets`
    );
  }
  if (scanned.roots.length === 0) throw new TreeError(path, `${label} must contain at least one element`);
  const stray = scanned.roots.find((root) => !allowedRoots.includes(root));
  if (stray !== undefined) throw new TreeError(path, `${label} <${stray}> is not allowed in ${where}`);
}

function assertRawXmlFits(parent: Parent, node: AuthorNode, path: readonly string[]): void {
  const { xml } = node.props;
  if (typeof xml !== "string") throw new TreeError(path, `RawXml xml must be a string, got ${typeof xml}`);
  const slot = RAW_XML_SLOT[ELEMENTS[parent.kind].content];
  if (slot === undefined) throw new TreeError(path, `<RawXml> is not allowed in <${parent.name}>`);
  const allowedRoots = RAW_XML_ROOTS[slot];
  assertFragment({ xml, label: "RawXml", allowedRoots, where: `<${parent.name}>` }, path);
}

function assertCellEndsWithParagraph(children: readonly (Built | string)[], path: readonly string[]): void {
  const last = children[children.length - 1];
  if (typeof last === "object" && last.type === "RawXml") {
    throw new TreeError(path, "A TableCell must end with a <Paragraph>");
  }
}

function assertFootnoteStartsWithParagraph(children: readonly (Built | string)[], path: readonly string[]): void {
  const first = children[0];
  if (typeof first !== "object" || first.type !== "Paragraph") {
    throw new TreeError(path, "A Footnote must start with a <Paragraph>");
  }
}

function recordCommentId(kind: Kind, props: PropBag, path: readonly string[], state: DocumentState): void {
  if (kind === "Comment") {
    if (state.commentIds.has(props.id)) throw new TreeError(path, `A second <Comment id={${String(props.id)}}>`);
    state.commentIds.add(props.id);
  } else if (COMMENT_MARKS.includes(kind)) {
    state.commentMarks.push({ id: props.id, path });
  }
}

function assertCommentIdsResolve(state: DocumentState): void {
  const dangling = state.commentMarks.find(({ id }) => !state.commentIds.has(id));
  if (dangling !== undefined) throw new TreeError(dangling.path, `No <Comment id={${String(dangling.id)}}>`);
}

function canonicalProps(kind: Kind, props: PropBag, path: readonly string[]): PropBag {
  assertNoRemovedProps(kind, props, path);
  const own = omit(props, "children");
  const rule = PROP_RULES[kind];
  return rule ? rule(own, path) : own;
}

function omit(props: PropBag, ...keys: string[]): PropBag {
  const rest = { ...props };
  for (const key of keys) delete rest[key];
  return rest;
}

function textProp(props: PropBag, path: readonly string[]): string | undefined {
  const { text } = props;
  if (text === undefined || typeof text === "string") return text;
  throw new TreeError(path, `text must be a string, got ${typeof text}`);
}

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

function imageBytes(props: PropBag, path: readonly string[]): PropBag {
  const { fallback } = props;
  return {
    ...props,
    data: bytes(props.data, path),
    ...(isRecord(fallback) ? { fallback: { ...fallback, data: bytes(fallback.data, path) } } : {}),
  };
}

function bytes(data: unknown, path: readonly string[]): Uint8Array {
  if (typeof data === "string") {
    return Uint8Array.from(atob(data.replace(DATA_URL_PREFIX, "")), (char) => char.charCodeAt(0));
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data.constructor === Uint8Array ? data : new Uint8Array(data);
  throw new TreeError(path, "ImageRun data must be a base64 string, an ArrayBuffer or a Uint8Array");
}

type StyleList = "paragraphStyles" | "characterStyles";
const STYLE_LIST_KIND = { paragraphStyles: "paragraph", characterStyles: "character" } as const;

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

function assertImportedStyles(props: PropBag, path: readonly string[]): PropBag {
  if (!isRecord(props.styles) || props.styles.importedStyles === undefined) return props;
  const { importedStyles, paragraphStyles, characterStyles } = props.styles;
  if (!Array.isArray(importedStyles)) throw new TreeError(path, "styles.importedStyles takes XML strings");
  const entries: readonly unknown[] = importedStyles;
  const defined = new Set([...STYLE_SLOTS.keys(), ...styleIds(paragraphStyles), ...styleIds(characterStyles)]);
  entries.forEach((xml, i) => {
    if (typeof xml !== "string") throw new TreeError(path, "styles.importedStyles takes XML strings");
    const label = `styles.importedStyles[${i}]`;
    assertFragment({ xml, label, allowedRoots: RAW_XML_ROOTS.style, where: "styles.xml" }, path);
    for (const [, id] of xml.matchAll(STYLE_ID)) {
      if (defined.has(id)) throw new TreeError(path, `${label} defines style "${id}", which is already defined`);
      defined.add(id);
    }
  });
  return props;
}

function styleIds(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const styles: readonly unknown[] = entries;
  return styles.flatMap((entry) => (isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []));
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
  const lists = { nextInstance: () => context.document.nextListInstance++, levels: context.document.listLevels };
  return listEntries(list, path, lists).map((entry) => {
    context.document.listDefinitions.set(entry.definition.reference, entry.definition);
    const paragraph = canonicalNode("Paragraph", entry.item, entry.content, entry.path, context);
    return { ...paragraph, props: { ...paragraph.props, numbering: entry.numbering } };
  });
}

function withListNumbering(
  props: PropBag,
  config: readonly ListEntry["definition"][],
  used: ReadonlyMap<string, ListEntry["definition"]>
): PropBag {
  const numbering = isRecord(props.numbering) ? props.numbering : {};
  const configured = new Set(config.map((entry) => entry.reference));
  const base = new Set(LIST_NUMBERING.config.map((entry) => entry.reference));
  const wanted = [...LIST_NUMBERING.config, ...[...used.values()].filter((entry) => !base.has(entry.reference))];
  const missing = wanted.filter((entry) => !configured.has(entry.reference));
  if (missing.length === 0) return props;
  return { ...props, numbering: { ...numbering, config: [...config, ...missing] } };
}
