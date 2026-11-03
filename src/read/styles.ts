/** word/styles.xml → Document.styles (decision 8).
 *
 *  - w:docDefaults → `default.document`. Paragraph and character styles → `paragraphStyles` and
 *    `characterStyles`, in the file's order. Styles docx.js cannot express (Word's default style, table and
 *    numbering styles) → raw `importedStyles`.
 *  - Styles nothing references are kept: Word users expect their style gallery.
 *  - A style with one of docx.js's built-in ids (Heading1, Title, …) is left in its list; canonicalize
 *    folds it into `styles.default.<key>`. */

import type * as docx from "docx";
import { readDocDefaults, readStyle } from "../ooxml/style";
import type { StylesProps } from "../schema/elements";
import { READ_IN_UNIT_05 } from "./body";
import { partOfType, type ReadContext } from "./context";
import { attrOf, elementsOf, type XmlElement } from "./xml";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function readStyles(root: XmlElement, ctx: ReadContext): StylesProps | undefined {
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
      if (read.kind === "dropped") {
        ctx.report({ kind: "dropped", element: "w:style", detail: `${id}: ${read.because}` });
      } else if (read.kind === "raw") {
        importedStyles.push(read.xml);
      } else {
        ctx.notes(read.notes);
        if (read.kind === "character") {
          characterStyles.push(read.options);
        } else {
          paragraphStyles.push(read.options);
          if (read.numPr !== null) ctx.report({ kind: "dropped", element: "w:numPr", detail: `${id}: ${READ_IN_UNIT_05}` });
        }
      }
    }
  }
  if (paragraphStyles.length > 0) styles.paragraphStyles = paragraphStyles;
  if (characterStyles.length > 0) styles.characterStyles = characterStyles;
  if (importedStyles.length > 0) styles.importedStyles = importedStyles;
  return Object.keys(styles).length === 0 ? undefined : styles;
}

/** The styles part found through the main part's `styles` relationship, falling back to word/styles.xml. */
export function readStylesPart(ctx: ReadContext): StylesProps | undefined {
  const path = partOfType(ctx.pkg, "/styles", "word/styles.xml");
  const root = ctx.readPart(path);
  return root === null ? undefined : readStyles(root, ctx.within(path, []));
}
