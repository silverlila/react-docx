import { DEFAULT_STYLE_SLOTS, PAGE_NUMBER_VALUES, PRESENCE_ONLY, RAW_XML_ROOTS } from "../schema/docx-facts";
import { ELEMENTS, isKind, type DocumentNode, type Kind } from "../schema/elements";
import { LIST_NUMBERING, listEntries, listLevels, type ListEntry, type ListLevels } from "./lists";
import { xmlRoots } from "./xml-roots";

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
    super(path.length === 0 ? message : `${path.join(" > ")}: ${message}`);
    this.name = "TreeError";
  }
}

type PropBag = Readonly<Record<string, unknown>>;
/** A canonical node before its props are trusted as `Props<K>`: they are not validated, TSX type-checked them. */
type Built = { readonly type: Kind; readonly props: PropBag; readonly children: readonly (Built | string)[] };
/** One canonicalize call's document-wide state, shared by every node. */
type DocumentState = {
  nextListInstance: number;
  /** Each list definition an expanded List numbers with, by reference, in first-use order. */
  readonly listDefinitions: Map<string, ListEntry["definition"]>;
  /** The levels Lists of each type number with: the document's own, or LIST_NUMBERING's. */
  readonly listLevels: ListLevels;
  /** Rule 19: every Comment id, and each id a comment range or reference names, with that node's path. */
  readonly commentIds: Set<unknown>;
  readonly commentMarks: { readonly id: unknown; readonly path: readonly string[] }[];
};
type Context = {
  readonly document: DocumentState;
  /** Rule 18: inside a Header, Footer, Comment or Footnote, whose content docx.js reads no footnote references from. */
  readonly outsideBody: boolean;
};
type Parent = { readonly kind: Kind; readonly name: string; readonly path: readonly string[] };

const SUGAR: readonly string[] = ["List", "ListItem", "Break"];
const PAGE_NUMBERS: readonly string[] = PAGE_NUMBER_VALUES;
const STYLE_SLOTS = new Map(Object.entries(DEFAULT_STYLE_SLOTS));
const DATA_URL_PREFIX = /^data:[^,]*;base64,/;
/** Only relationship attributes live in the `r:` namespace, so a regex needs no parser and has no false positives. */
const RELATIONSHIP_ATTRIBUTE = /\sr:[A-Za-z]+\s*=/;
const STYLE_ID = /w:styleId="([^"]+)"/g;
const OUTSIDE_BODY: readonly Kind[] = ["Header", "Footer", "Comment", "Footnote"];
/** The kinds whose string children are literal text, split at Breaks and read for PageNumber values. */
type RunKind = "TextRun" | "InsertedTextRun" | "DeletedTextRun";
const RUN_KINDS: readonly Kind[] = ["TextRun", "InsertedTextRun", "DeletedTextRun"];
/** Rule 17: the kinds whose loose strings and inline content are wrapped into Paragraphs. */
const WRAPS_LOOSE_CONTENT: readonly Kind[] = ["Footnote", "Comment", "Textbox"];
const COMMENT_MARKS: readonly Kind[] = ["CommentRangeStart", "CommentRangeEnd", "CommentReference"];
/** The author node a rule-17 Paragraph is built from: its children are the loose content, given separately. */
const LOOSE_PARAGRAPH: AuthorNode = { type: "Paragraph", props: {}, children: [] };

/** The kinds a RawXml may stand in, and which RAW_XML_ROOTS list its fragment's roots come from there. */
type RawXmlParent = { [K in Kind]: "RawXml" extends (typeof ELEMENTS)[K]["children"][number] ? K : never }[Kind];
const RAW_XML_SLOT: { readonly [K in RawXmlParent]: Exclude<keyof typeof RAW_XML_ROOTS, "style"> } = {
  Section: "block",
  Header: "block",
  Footer: "block",
  TableCell: "block",
  Paragraph: "inline",
  ExternalHyperlink: "inline",
  InternalHyperlink: "inline",
  Bookmark: "inline",
  TextRun: "run",
  InsertedTextRun: "run",
  DeletedTextRun: "run",
};

/** The child a non-empty `text` prop becomes, inserted first. A run kind's `text` is handled in `runs`. */
const TEXT_PROP_CHILD: { readonly [K in Kind]?: (text: string) => Built } = {
  Paragraph: (text) => literalRun({}, text),
  Math: (text) => ({ type: "MathRun", props: {}, children: [text] }),
};

const IMPORTED_STYLES = "use styles.importedStyles, XML strings of <w:style> elements";

/** Props 0.1 took that 0.2 replaced, each with its replacement. TypeScript rejects them; this rejects the
 *  untyped callers that would otherwise have them ignored or passed to docx.js unchecked. */
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

/** Per-kind prop rules. `children` is dropped from every kind before these run. */
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

/** Pure. Never mutates its input. canonicalize(canonicalize(x)) deep-equals canonicalize(x).
 *
 *  Invariant that makes it so: a canonical run's `children` (TextRun, InsertedTextRun, DeletedTextRun) never
 *  contain a string equal to a PAGE_NUMBER_VALUES member, nor `""`, since a second pass would read the first as
 *  a field and drop the second. Such a literal lives in `props.text` of a run of its own: the same kind, no
 *  children, the same other props as the run it came from. `text` on a canonical run appears only in that form. */
export function canonicalize(root: AuthorNode): DocumentNode {
  if (root.type !== "Document") {
    throw new TreeError([root.type], `The root must be <Document>, got <${root.type}>`);
  }
  const state: DocumentState = {
    nextListInstance: 0,
    listDefinitions: new Map(),
    listLevels: listLevels(root.props.numbering),
    commentIds: new Set(),
    commentMarks: [],
  };
  const document = canonicalNode("Document", root, indexed(root.children), ["Document"], {
    document: state,
    outsideBody: false,
  });
  assertCommentIdsResolve(state);
  const props = state.listDefinitions.size > 0 ? withListNumbering(document.props, state.listDefinitions) : document.props;
  // The placement checks enforce the child structure DocumentNode describes; props are trusted as authored.
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
  kind: Kind,
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
  const parent: Parent = { kind, name: node.type, path };
  const inner = OUTSIDE_BODY.includes(kind) ? { ...context, outsideBody: true } : context;
  const authored = [...textPropChild(kind, node.props, path), ...canonicalChildren(parent, content, inner)];
  // w:txbxContent must hold at least one block; Word writes an empty text box with one empty paragraph.
  const children = kind === "Textbox" && authored.length === 0 ? [emptyParagraph()] : authored;
  if (kind === "TableCell") assertCellEndsWithParagraph(children, path);
  if (kind === "Footnote") assertFootnoteStartsWithParagraph(children, path);
  return { type: kind, props: canonicalProps(kind, node.props, path), children };
}

/** A placed author node as canonical nodes: a run may split into several at its Breaks,
 *  and a RawXml is checked against the slot its parent gives it. */
function nodesFor(parent: Parent, kind: Kind, node: AuthorNode, path: readonly string[], context: Context): Built[] {
  if (isRunKind(kind)) return runs(kind, node, path, context);
  if (kind === "RawXml") assertRawXmlFits(parent, node, path);
  return [canonicalNode(kind, node, indexed(node.children), path, context)];
}

function isRunKind(kind: Kind): kind is RunKind {
  return RUN_KINDS.includes(kind);
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
  if (WRAPS_LOOSE_CONTENT.includes(parent.kind)) return wrappedBlockChildren(parent, content, context);
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
    return nodesFor(parent, placedKind(parent, child, path), child, path, context);
  });
}

/** Rule 17. Footnote, Comment, Textbox: each run of consecutive strings and inline content becomes one Paragraph,
 *  whose children keep their authored paths. The rest are block children. */
function wrappedBlockChildren(parent: Parent, content: readonly IndexedChild[], context: Context): Built[] {
  return looseRuns(parent.kind, content).flatMap((group) =>
    group.loose
      ? [canonicalNode("Paragraph", LOOSE_PARAGRAPH, group.content, parent.path, context)]
      : blockChildren(parent, group.content, context)
  );
}

/** Consecutive children grouped by whether they are loose content `parent` cannot hold directly. */
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

/** A string, or a node a Paragraph holds (directly, or wrapped in a TextRun) that `parent` does not. */
function isLoose(parent: Kind, child: AuthorNode | string): boolean {
  if (typeof child === "string") return true;
  if (isLegalIn(parent, child.type)) return false;
  return child.type === "Break" || isLegalIn("Paragraph", child.type) || isLegalIn("TextRun", child.type);
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
          return [textRun({}, [canonicalNode(node.type, node, indexed(node.children), path, context)])];
        }
        return nodesFor(parent, placedKind(parent, node, path), node, path, context);
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
        return nodesFor(parent, placedKind(parent, node, path), node, path, context);
      }
    }
  });
}

/** MathRun: strings are literal, merged, and empty ones dropped. */
function literalChildren(parent: Parent, content: readonly IndexedChild[], context: Context): (Built | string)[] {
  const items = content.flatMap(({ child, index }): (Built | string)[] => {
    if (typeof child === "string") return child === "" ? [] : [child];
    const path = childPath(parent.path, child, index);
    return nodesFor(parent, placedKind(parent, child, path), child, path, context);
  });
  return mergeStrings(items);
}

/** Document, Table, TableRow and leaf kinds: element children only. */
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
  return run("TextRun", props, children);
}

function run(kind: RunKind, props: PropBag, children: readonly (Built | string)[]): Built {
  return { type: kind, props, children };
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

// ─── Runs: fields, the text prop, and splitting at Breaks ──────────────────────

const BREAK: unique symbol = Symbol("Break");
/** A protected literal, which never merges with its neighbours and is written as a `text` run of its own. */
type Literal = { readonly literal: string };
type SegmentItem = Built | string | Literal;
type RunItem = SegmentItem | typeof BREAK;
type Segment = { breaks: number; content: SegmentItem[] };

/** TextRun, InsertedTextRun and DeletedTextRun alike: a split keeps the kind and props for every part. */
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

/** A segment's runs. Adjacent strings merge first, and a merged string that is protected becomes a Literal.
 *  Each Literal is a `text` run of its own; the content between Literals shares a run. Only the first run
 *  keeps the segment's `break`, so `break` still counts only the Breaks that lead the content. */
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

// ─── RawXml ────────────────────────────────────────────────────────────────────

type Fragment = {
  readonly xml: string;
  /** Names the fragment in messages: `RawXml`, `styles.importedStyles[0]`. */
  readonly label: string;
  readonly allowedRoots: readonly string[];
  /** Where the fragment stands, for messages: `<Paragraph>`, `styles.xml`. */
  readonly where: string;
};

/** Rules 13 and 14: a well-formed fragment of at least one element, each root allowed where it stands,
 *  and no relationship references, whose targets docx.js cannot write. */
function assertFragment({ xml, label, allowedRoots, where }: Fragment, path: readonly string[]): void {
  if (!xml.includes("<")) throw new TreeError(path, `${label} must contain at least one element`);
  const scanned = xmlRoots(xml);
  if (scanned.kind === "malformed") throw new TreeError(path, `${label} is not well-formed: ${scanned.reason}`);
  if (scanned.kind === "unwritable") throw new TreeError(path, `${label} cannot be written: ${scanned.reason}`);
  if (scanned.roots.length === 0) throw new TreeError(path, `${label} must contain at least one element`);
  const stray = scanned.roots.find((root) => !allowedRoots.includes(root));
  if (stray !== undefined) throw new TreeError(path, `${label} <${stray}> is not allowed in ${where}`);
  if (RELATIONSHIP_ATTRIBUTE.test(xml)) {
    throw new TreeError(
      path,
      `${label} cannot carry relationship references (r:id, r:embed, …): docx.js cannot write their targets`
    );
  }
}

function isRawXmlParent(kind: Kind): kind is RawXmlParent {
  return Object.prototype.hasOwnProperty.call(RAW_XML_SLOT, kind);
}

function assertRawXmlFits(parent: Parent, node: AuthorNode, path: readonly string[]): void {
  const { xml } = node.props;
  if (typeof xml !== "string") throw new TreeError(path, `RawXml xml must be a string, got ${typeof xml}`);
  if (!isRawXmlParent(parent.kind)) throw new TreeError(path, `<RawXml> is not allowed in <${parent.name}>`);
  const allowedRoots = RAW_XML_ROOTS[RAW_XML_SLOT[parent.kind]];
  assertFragment({ xml, label: "RawXml", allowedRoots, where: `<${parent.name}>` }, path);
}

/** Rule 15. docx.js appends an empty `<w:p/>` after any trailing child that is not its own Paragraph,
 *  a raw `<w:p>` included, which would change the cell. */
function assertCellEndsWithParagraph(children: readonly (Built | string)[], path: readonly string[]): void {
  const last = children[children.length - 1];
  if (typeof last === "object" && last.type === "RawXml") {
    throw new TreeError(path, "A TableCell must end with a <Paragraph>");
  }
}

// ─── Footnotes and comments ────────────────────────────────────────────────────

/** docx.js puts the footnote's own number mark at the front of its first child, which must be a Paragraph:
 *  a leading Table crashes it, and an empty Footnote would show no number. */
function assertFootnoteStartsWithParagraph(children: readonly (Built | string)[], path: readonly string[]): void {
  const first = children[0];
  if (typeof first !== "object" || first.type !== "Paragraph") {
    throw new TreeError(path, "A Footnote must start with a <Paragraph>");
  }
}

/** Rule 19, as nodes are reached: a Comment id is taken once; a range or reference id is kept to resolve later. */
function recordCommentId(kind: Kind, props: PropBag, path: readonly string[], state: DocumentState): void {
  if (kind === "Comment") {
    if (state.commentIds.has(props.id)) throw new TreeError(path, `A second <Comment id={${String(props.id)}}>`);
    state.commentIds.add(props.id);
  } else if (COMMENT_MARKS.includes(kind)) {
    state.commentMarks.push({ id: props.id, path });
  }
}

/** Rule 19, once the whole document is read: Comments may follow the ranges that name them. */
function assertCommentIdsResolve(state: DocumentState): void {
  const dangling = state.commentMarks.find(({ id }) => !state.commentIds.has(id));
  if (dangling !== undefined) throw new TreeError(dangling.path, `No <Comment id={${String(dangling.id)}}>`);
}

// ─── Props ─────────────────────────────────────────────────────────────────────

function canonicalProps(kind: Kind, props: PropBag, path: readonly string[]): PropBag {
  assertNoRemovedProps(kind, props, path);
  const own = omit(props, "children");
  const rule = PROP_RULES[kind];
  return withoutPresenceOnlyFalse(kind, rule ? rule(own, path) : own);
}

function omit(props: PropBag, ...keys: string[]): PropBag {
  const rest = { ...props };
  for (const key of keys) delete rest[key];
  return rest;
}

export function isRecord(value: unknown): value is PropBag {
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

/** Rule 16. Raw styles are written after docx.js's own and the style lists', so a `w:styleId` one of
 *  those already defines, or an earlier raw style defines, would be defined twice. */
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

/** Adds both LIST_NUMBERING configs, then each other definition the Lists used, unless the document
 *  already configures that reference. */
function withListNumbering(props: PropBag, used: ReadonlyMap<string, ListEntry["definition"]>): PropBag {
  const numbering = isRecord(props.numbering) ? props.numbering : {};
  const config: unknown[] = Array.isArray(numbering.config) ? numbering.config : [];
  const configured = new Set(config.map((entry) => (isRecord(entry) ? entry.reference : undefined)));
  const base = new Set(LIST_NUMBERING.config.map((entry) => entry.reference));
  const wanted = [...LIST_NUMBERING.config, ...[...used.values()].filter((entry) => !base.has(entry.reference))];
  const missing = wanted.filter((entry) => !configured.has(entry.reference));
  if (missing.length === 0) return props;
  return { ...props, numbering: { ...numbering, config: [...config, ...missing] } };
}
