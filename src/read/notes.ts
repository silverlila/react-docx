/** Footnotes (word/footnotes.xml) and comments (word/comments.xml): which ids exist, their content with
 *  the mark run Word and docx.js write themselves removed, and the Footnote and Comment nodes.
 *
 *  - The body walk reads a footnote's content where its reference stands, because Footnote is inline.
 *    Separator footnotes are docx.js's own and counted ignored; a footnote no body reference reaches is
 *    dropped, since docx.js writes only referenced ones.
 *  - The first paragraph's run holding w:footnoteRef (or a comment's w:annotationRef) is removed: docx.js
 *    writes its own footnote number mark, and Word draws comment marks itself.
 *  - Comment ids are ordinals of first appearance (decision 5), counted from 0 like phase 1's: marks in
 *    reading order first, then unreferenced comments in file order.
 *  - A comment's w:date becomes a Date, and a comment without one has no `date`: phase 1 writes no w:date
 *    for an undated Comment. */

import type { AuthorNode } from "../tree/author";
import { partOfType, type ReadContext } from "./context";
import { attrOf, elementsOf, type XmlElement } from "./xml";

export type CommentRead = {
  readonly id: number;
  /** The w:comment, for its attributes. */
  readonly comment: XmlElement;
  /** Its content, without the w:annotationRef run. */
  readonly content: XmlElement;
};

export type NotesReader = {
  readonly footnotesPart: string;
  readonly commentsPart: string;
  /** The content of footnote `id` without its w:footnoteRef run, or null (reported dropped at `ctx`) when
   *  footnotes.xml has no such footnote. A second reference is reported resolved. */
  footnote(id: string, ctx: ReadContext): XmlElement | null;
  /** The ordinal id of comment `id`, or null when comments.xml has no such comment. */
  commentId(id: string): number | null;
  /** Every comment in id order. Call once, after the body is read. */
  comments(): readonly CommentRead[];
  /** Reports each footnote no reference reached. Call once, after all reading. */
  reportUnreferenced(): void;
};

const SEPARATORS = ["separator", "continuationSeparator", "continuationNotice"];
const COMMENT_SPACE = "comment";

const node = (type: string, props: Readonly<Record<string, unknown>>, children: readonly AuthorNode[]): AuthorNode => ({
  type,
  props,
  children,
});

const holds = (el: XmlElement, name: string): boolean => elementsOf(el).some((child) => child.name === name);

/** `container` without the runs of its first paragraph that hold `mark`, each counted ignored. */
function withoutMarkRun(container: XmlElement, mark: string, ctx: ReadContext): XmlElement {
  const first = elementsOf(container).find((el) => el.name === "w:p");
  if (first === undefined) return container;
  const paragraph: XmlElement = {
    ...first,
    children: first.children.filter((child) => {
      if (typeof child === "string" || child.name !== "w:r" || !holds(child, mark)) return true;
      ctx.ignore(mark);
      return false;
    }),
  };
  return { ...container, children: container.children.map((child) => (child === first ? paragraph : child)) };
}

/** Children of the part root named `name`, by w:id; one without an id or with a repeated id is dropped. */
function byId(root: XmlElement | null, name: string, here: ReadContext): Map<string, XmlElement> {
  const found = new Map<string, XmlElement>();
  for (const el of elementsOf(root)) {
    const id = attrOf(el, "w:id");
    if (el.name !== name || id === null || found.has(id)) {
      here.report({ kind: "dropped", element: el.name, detail: `not a ${name} with an id of its own` });
    } else {
      found.set(id, el);
    }
  }
  return found;
}

export function readNotesParts(ctx: ReadContext): NotesReader {
  const footnotesPart = partOfType(ctx.pkg, "/footnotes", "word/footnotes.xml");
  const commentsPart = partOfType(ctx.pkg, "/comments", "word/comments.xml");
  const footnotesHere = ctx.within(footnotesPart, []);
  const footnotes = byId(ctx.readPart(footnotesPart), "w:footnote", footnotesHere);
  for (const [id, footnote] of footnotes) {
    if (!SEPARATORS.includes(attrOf(footnote, "w:type") ?? "")) continue;
    footnotes.delete(id);
    ctx.ignore("w:footnote");
  }
  const comments = byId(ctx.readPart(commentsPart), "w:comment", ctx.within(commentsPart, []));
  const referenced = new Set<string>();
  const commentOrdinal = (id: string): number => ctx.ordinals.next(COMMENT_SPACE, id) - 1;

  return {
    footnotesPart,
    commentsPart,
    footnote(id, at) {
      const footnote = footnotes.get(id);
      if (footnote === undefined) {
        at.report({ kind: "dropped", element: "w:footnoteReference", detail: `footnote ${id} is not in ${footnotesPart}` });
        return null;
      }
      if (referenced.has(id)) {
        at.report({ kind: "resolved", element: "w:footnoteReference", detail: `footnote ${id} referenced twice; content duplicated` });
      }
      referenced.add(id);
      return withoutMarkRun(footnote, "w:footnoteRef", ctx);
    },
    commentId(id) {
      return comments.has(id) ? commentOrdinal(id) : null;
    },
    comments() {
      return [...comments]
        .map(([id, comment]) => ({ id: commentOrdinal(id), comment, content: withoutMarkRun(comment, "w:annotationRef", ctx) }))
        .sort((a, b) => a.id - b.id);
    },
    reportUnreferenced() {
      for (const id of footnotes.keys()) {
        if (referenced.has(id)) continue;
        footnotesHere.report({ kind: "dropped", element: "w:footnote", detail: `footnote ${id} is never referenced, and docx.js writes only referenced footnotes` });
      }
    },
  };
}

/** A Footnote of the blocks read from footnote `id`. canonicalize requires a leading Paragraph, which Word
 *  always writes; a footnote without one gets an empty one. */
export function footnoteNode(blocks: readonly AuthorNode[], id: string, ctx: ReadContext): AuthorNode {
  if (blocks[0]?.type === "Paragraph") return node("Footnote", {}, blocks);
  ctx.report({ kind: "resolved", element: "w:footnote", detail: `footnote ${id} did not start with a paragraph` });
  return node("Footnote", {}, [node("Paragraph", {}, []), ...blocks]);
}

/** A Comment of one comment's attributes and the blocks read from its content. */
export function commentNode(read: CommentRead, blocks: readonly AuthorNode[], ctx: ReadContext): AuthorNode {
  const author = attrOf(read.comment, "w:author");
  const initials = attrOf(read.comment, "w:initials");
  const source = attrOf(read.comment, "w:date");
  const date = source === null ? null : new Date(source);
  if (date !== null && Number.isNaN(date.getTime())) {
    ctx.report({ kind: "dropped", element: "w:comment", detail: `w:date="${source}" is not a date` });
  }
  const props = {
    id: read.id,
    ...(author === null ? {} : { author }),
    ...(initials === null ? {} : { initials }),
    ...(date === null || Number.isNaN(date.getTime()) ? {} : { date }),
  };
  return node("Comment", props, blocks);
}
