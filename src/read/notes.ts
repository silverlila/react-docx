/** Word and docx.js write the footnote number mark (w:footnoteRef) and the comment mark (w:annotationRef)
 *  themselves. docx.js writes separator footnotes itself and writes only referenced footnotes. It writes
 *  no w:date for an undated Comment. */

import { node, type AuthorNode } from "../tree/author";
import { partOfType, type ReadContext } from "./context";
import { attrOf, elementsOf, type XmlElement } from "../ooxml/xml";

type CommentRead = {
  readonly id: number;
  readonly comment: XmlElement;
  readonly content: XmlElement;
};

export type NotesReader = {
  readonly footnotesPart: string;
  readonly commentsPart: string;
  footnote(id: string, ctx: ReadContext): XmlElement | null;
  commentId(id: string): number | null;
  comments(): readonly CommentRead[];
  reportUnreferenced(): void;
};

const SEPARATORS = ["separator", "continuationSeparator", "continuationNotice"];
const COMMENT_SPACE = "comment";

const holds = (el: XmlElement, name: string): boolean => elementsOf(el).some((child) => child.name === name);

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
  const commentOrdinal = (id: string): number => ctx.ordinals(COMMENT_SPACE, id) - 1;

  return {
    footnotesPart,
    commentsPart,
    footnote(id, at) {
      const footnote = footnotes.get(id);
      if (footnote === undefined) {
        at.report({
          kind: "dropped",
          element: "w:footnoteReference",
          detail: `footnote ${id} is not in ${footnotesPart}`,
        });
        return null;
      }
      if (referenced.has(id)) {
        at.report({
          kind: "resolved",
          element: "w:footnoteReference",
          detail: `footnote ${id} referenced twice; content duplicated`,
        });
      }
      referenced.add(id);
      return withoutMarkRun(footnote, "w:footnoteRef", ctx);
    },
    commentId(id) {
      return comments.has(id) ? commentOrdinal(id) : null;
    },
    comments() {
      return [...comments]
        .map(([id, comment]) => ({
          id: commentOrdinal(id),
          comment,
          content: withoutMarkRun(comment, "w:annotationRef", ctx),
        }))
        .sort((a, b) => a.id - b.id);
    },
    reportUnreferenced() {
      for (const id of footnotes.keys()) {
        if (referenced.has(id)) continue;
        footnotesHere.report({
          kind: "dropped",
          element: "w:footnote",
          detail: `footnote ${id} is never referenced, and docx.js writes only referenced footnotes`,
        });
      }
    },
  };
}

export function footnoteNode(blocks: readonly AuthorNode[], id: string, ctx: ReadContext): AuthorNode {
  if (blocks[0]?.type === "Paragraph") return node("Footnote", {}, blocks);
  ctx.report({ kind: "resolved", element: "w:footnote", detail: `footnote ${id} did not start with a paragraph` });
  return node("Footnote", {}, [node("Paragraph", {}, []), ...blocks]);
}

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
