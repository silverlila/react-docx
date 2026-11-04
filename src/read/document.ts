/** The Document author node: sections with their headers and footers, document properties, settings and
 *  styles, and a `dropped` diagnostic for every part no reader consumed.
 *
 *  - A section ends after each body w:p whose w:pPr holds a w:sectPr, and that paragraph belongs to it.
 *    The last section's w:sectPr is w:body's own.
 *  - docx.js writes every section but the last as its blocks plus an empty paragraph holding only the
 *    w:sectPr. A paragraph with no content is therefore read as that section mark and not as a Paragraph,
 *    or each round trip would add one; any paragraph properties it has are reported dropped.
 *  - A section-ending paragraph with content (Word's usual shape) is read as a Paragraph, and docx.js
 *    adds its own empty mark after it on write, so the first round trip adds one empty paragraph to each
 *    section but the last. docx.js has no option to put a w:sectPr on an authored paragraph.
 *  - Header and Footer children come before the body blocks. A section with no references gets none:
 *    Word inherits the previous section's, and docx.js writing none keeps that.
 *  - Settings are editor state and docx.js writes its own, so only the four it has options for are read,
 *    and only when on, since off is their default. The rest are counted ignored.
 *  - Custom properties are kept only as vt:lpwstr, the one value type docx.js writes.
 *  - Numbering, footnotes and comments are opened before the body, which reads them as it meets their
 *    references. Comments become Document children after the Sections. Styles are read after the body, so
 *    the lists only a style uses come after the body's.
 *  - docx.js recomputes app.xml's statistics, so app.xml is not read. */

import type * as docx from "docx";
import { colorOf, wholeNumberAt, type Mutable, type Note } from "../ooxml/codec";
import { readSectionProperties } from "../ooxml/section";
import { node, type AuthorNode } from "../tree/author";
import { bodyContext, readBlocks, withoutGoBack, type BodyContext } from "./body";
import { partOfType, type ReadContext } from "./context";
import { commentNode, readNotesParts } from "./notes";
import { readNumberingPart } from "./numbering";
import { NotADocxError } from "./package";
import { readStylesPart } from "./styles";
import { attrOf, childNamed, elementsOf, isOn, textOf, type XmlElement } from "../ooxml/xml";

type DocumentProps = Mutable<Omit<docx.IPropertiesOptions, "sections" | "styles">> & {
  styles?: ReturnType<typeof readStylesPart>;
};

type SectionXml = {
  readonly elements: readonly XmlElement[];
  readonly sectPr: XmlElement | null;
  readonly markProperties: readonly XmlElement[];
};

const CORE_PART = "docProps/core.xml";
const CUSTOM_PART = "docProps/custom.xml";
const DEFAULT_THEME = "word/theme/theme1.xml";
const PLUMBING = ["[Content_Types].xml", "docProps/app.xml"];
const IGNORED_PARTS = ["word/fontTable.xml", "word/webSettings.xml"];
const DROPPED_PARTS: Readonly<Record<string, string>> = {
  "word/commentsExtended.xml": "comment resolved state: docx.js cannot write it",
  "word/commentsIds.xml": "comment threading ids: docx.js cannot write them",
  "word/commentsExtensible.xml": "comment threading dates: docx.js cannot write them",
  "word/endnotes.xml": "docx.js cannot write endnotes",
};

function withoutSectPr(p: XmlElement, pPr: XmlElement): XmlElement {
  const properties = { ...pPr, children: pPr.children.filter((child) => typeof child === "string" || child.name !== "w:sectPr") };
  return { ...p, children: p.children.map((child) => (child === pPr ? properties : child)) };
}

function splitSections(body: XmlElement): SectionXml[] {
  const sections: SectionXml[] = [];
  let elements: XmlElement[] = [];
  for (const el of elementsOf(body)) {
    if (el.name === "w:sectPr") continue;
    const pPr = el.name === "w:p" ? childNamed(el, "w:pPr") : null;
    const sectPr = childNamed(pPr, "w:sectPr");
    if (pPr === null || sectPr === null) {
      elements.push(el);
      continue;
    }
    const isMark = elementsOf(el).every((child) => child === pPr);
    if (!isMark) elements.push(withoutSectPr(el, pPr));
    const markProperties = isMark ? elementsOf(pPr).filter((child) => child !== sectPr) : [];
    sections.push({ elements, sectPr, markProperties });
    elements = [];
  }
  sections.push({ elements, sectPr: childNamed(body, "w:sectPr"), markProperties: [] });
  return sections;
}

const HEADER_FOOTER = {
  header: { kind: "Header", root: "w:hdr", reference: "w:headerReference" },
  footer: { kind: "Footer", root: "w:ftr", reference: "w:footerReference" },
} as const;

function readSection(section: SectionXml, index: number, ctx: BodyContext): AuthorNode {
  const here = ctx.within(ctx.pkg.mainPart, [index]);
  const read = readSectionProperties(section.sectPr, ctx.env);
  here.notes(read.notes);
  for (const el of section.markProperties) {
    here.report({ kind: "dropped", element: el.name, detail: "a property of the section-break paragraph, which docx.js writes itself" });
  }
  const rels = ctx.pkg.relsOf(ctx.pkg.mainPart);
  const children: AuthorNode[] = [];
  const seen = new Set<string>();
  for (const reference of read.references) {
    const which = HEADER_FOOTER[reference.kind];
    const key = `${reference.kind} ${reference.type}`;
    const rel = rels.get(reference.relId);
    const root = rel === undefined || rel.external ? null : ctx.readPart(rel.target);
    if (rel === undefined || root?.name !== which.root || seen.has(key)) {
      const why = seen.has(key) ? `a second ${reference.type} ${reference.kind}` : `r:id="${reference.relId}" is not a ${which.root} part`;
      here.report({ kind: "dropped", element: which.reference, detail: why });
      continue;
    }
    seen.add(key);
    const partCtx = ctx.within(rel.target, [index, children.length]);
    children.push(node(which.kind, { type: reference.type }, readBlocks(withoutGoBack(root, partCtx), partCtx)));
  }
  const body: XmlElement = { name: "w:body", attributes: {}, children: section.elements };
  return node("Section", read.options, [...children, ...readBlocks(body, here, { start: children.length })]);
}

function readCustomProperties(ctx: ReadContext): docx.IPropertiesOptions["customProperties"] {
  const root = ctx.readPart(CUSTOM_PART);
  const here = ctx.within(CUSTOM_PART, []);
  const properties: { name: string; value: string }[] = [];
  for (const property of elementsOf(root)) {
    const name = attrOf(property, "name");
    const [value, ...rest] = elementsOf(property);
    if (name === null || value?.name !== "vt:lpwstr" || rest.length > 0) {
      const type = value?.name ?? "no value";
      here.report({ kind: "dropped", element: property.name, detail: `${name ?? "(no name)"}: ${type} is not a vt:lpwstr, the only type docx.js writes` });
      continue;
    }
    properties.push({ name, value: textOf(value) });
  }
  return properties.length === 0 ? undefined : properties;
}

function readSettings(ctx: ReadContext, props: DocumentProps): void {
  const path = partOfType(ctx.pkg, "/settings", "word/settings.xml");
  const here = ctx.within(path, []);
  const features: Mutable<NonNullable<docx.IPropertiesOptions["features"]>> = {};
  const notes: Note[] = [];
  for (const el of elementsOf(ctx.readPart(path))) {
    if (el.name === "w:evenAndOddHeaders") {
      if (isOn(el)) props.evenAndOddHeaderAndFooters = true;
    } else if (el.name === "w:defaultTabStop") {
      const stop = wholeNumberAt(el, "w:val", notes);
      if (stop !== null) props.defaultTabStop = stop;
    } else if (el.name === "w:updateFields") {
      if (isOn(el)) features.updateFields = true;
    } else if (el.name === "w:trackRevisions") {
      if (isOn(el)) features.trackRevisions = true;
    } else {
      ctx.ignore(el.name);
    }
  }
  here.notes(notes);
  if (Object.keys(features).length > 0) props.features = features;
}

function readDocumentElement(document: XmlElement, ctx: ReadContext, props: DocumentProps): XmlElement {
  let body: XmlElement | null = null;
  for (const el of elementsOf(document)) {
    if (el.name === "w:body") {
      body = el;
    } else if (el.name === "w:background") {
      const notes: Note[] = [];
      const color = colorOf(el, ctx.env, notes, "w:color");
      ctx.notes(notes);
      if (color !== null) props.background = { color };
    } else {
      ctx.report({ kind: "dropped", element: el.name, detail: "docx.js has no document option for it" });
    }
  }
  if (body === null) throw new NotADocxError(`${ctx.pkg.mainPart} has no w:body.`);
  return body;
}

function reportUnreadParts(ctx: ReadContext, consumed: ReadonlySet<string>): void {
  for (const path of ctx.pkg.paths) {
    if (consumed.has(path) || path.endsWith(".rels") || PLUMBING.includes(path)) continue;
    if (IGNORED_PARTS.includes(path)) ctx.ignore(path);
    else ctx.within(path, []).report({ kind: "dropped", element: path, detail: DROPPED_PARTS[path] ?? "no reader reads this part" });
  }
}

function readComments(ctx: BodyContext, start: number): AuthorNode[] {
  const { notes } = ctx.parts;
  return notes.comments().map((read, i) => {
    const here = ctx.within(notes.commentsPart, [start + i]);
    return commentNode(read, readBlocks(read.content, here, { rawBlocks: false }), here);
  });
}

export function readDocumentNode(ctx: ReadContext, consumed: ReadonlySet<string>): AuthorNode {
  const root = ctx.readPart(ctx.pkg.mainPart);
  if (root?.name !== "w:document") throw new NotADocxError(`${ctx.pkg.mainPart} is not a w:document.`);
  const props: DocumentProps = { ...ctx.pkg.core };
  const body = readDocumentElement(root, ctx, props);
  const numbering = readNumberingPart(ctx);
  const bodyCtx = bodyContext(ctx, { numbering, notes: readNotesParts(ctx) });
  const sections = splitSections(withoutGoBack(body, ctx)).map((section, index) => readSection(section, index, bodyCtx));
  const comments = readComments(bodyCtx, sections.length);
  bodyCtx.parts.notes.reportUnreferenced();

  const customProperties = readCustomProperties(ctx);
  if (customProperties !== undefined) props.customProperties = customProperties;
  readSettings(ctx, props);
  const styles = readStylesPart(ctx, numbering);
  if (styles !== undefined) props.styles = styles;
  const config = numbering.config();
  if (config.length > 0) props.numbering = { config };
  numbering.reportUnused();
  ctx.readPart(CORE_PART);
  ctx.readPart(partOfType(ctx.pkg, "/theme", DEFAULT_THEME));
  reportUnreadParts(ctx, consumed);
  return node("Document", props, [...sections, ...comments]);
}
