/** docx.js cannot express Word's default style, table styles or numbering styles. A paragraph style's
 *  numPr needs `custom: true`, or docx.js writes pStyle ListParagraph into the style's own w:pPr. */

import type * as docx from "docx";
import type { Mutable } from "../ooxml/codec";
import { readDocDefaults, readStyle } from "../ooxml/style";
import type { StylesProps } from "../schema/elements";
import { partOfType, type ReadContext } from "./context";
import { numberingOption, type NumberingReader } from "./numbering";
import { attrOf, elementsOf, type XmlElement } from "../ooxml/xml";

function readStyles(root: XmlElement, ctx: ReadContext, numbering: NumberingReader): StylesProps | undefined {
  const styles: Mutable<StylesProps> = {};
  const paragraphStyles: docx.IParagraphStyleOptions[] = [];
  const characterStyles: docx.ICharacterStyleOptions[] = [];
  const importedStyles: string[] = [];
  for (const el of elementsOf(root)) {
    if (el.name === "w:latentStyles") {
      ctx.ignore(el.name);
    } else if (el.name === "w:docDefaults") {
      const read = readDocDefaults(el, ctx.env);
      ctx.notes(read.notes);
      if (Object.keys(read.options).length > 0) styles.default = { document: read.options };
    } else if (el.name !== "w:style") {
      ctx.report({ kind: "dropped", element: el.name, detail: "docx.js has no styles option for it" });
    } else {
      const read = readStyle(el, ctx.env);
      const id = attrOf(el, "w:styleId") ?? "(no w:styleId)";
      const renamed = ctx.env.styleIds?.get(id);
      if (renamed !== undefined) {
        const detail = `${id}: docx.js writes a built-in style ${id} of the other type, so this one is written as ${renamed}`;
        ctx.report({ kind: "resolved", element: "w:style", detail });
      }
      if (read.kind === "dropped") {
        ctx.report({ kind: "dropped", element: "w:style", detail: `${id}: ${read.because}` });
      } else if (read.kind === "raw") {
        importedStyles.push(read.xml);
      } else {
        ctx.notes(read.notes);
        if (read.kind === "character") {
          characterStyles.push(read.options);
        } else {
          const list = read.numPr === null ? null : numberingOption(read.numPr, { custom: true }, numbering, ctx);
          paragraphStyles.push(list === null ? read.options : withNumbering(read.options, list));
        }
      }
    }
  }
  if (paragraphStyles.length > 0) styles.paragraphStyles = paragraphStyles;
  if (characterStyles.length > 0) styles.characterStyles = characterStyles;
  if (importedStyles.length > 0) styles.importedStyles = importedStyles;
  return Object.keys(styles).length === 0 ? undefined : styles;
}

function withNumbering(
  style: docx.IParagraphStyleOptions,
  numbering: NonNullable<docx.IParagraphStylePropertiesOptions["numbering"]>
): docx.IParagraphStyleOptions {
  return { ...style, paragraph: { ...style.paragraph, numbering } };
}

export function readStylesPart(ctx: ReadContext, numbering: NumberingReader): StylesProps | undefined {
  const path = partOfType(ctx.pkg, "/styles", "word/styles.xml");
  const root = ctx.readPart(path);
  return root === null ? undefined : readStyles(root, ctx.within(path, []), numbering);
}
