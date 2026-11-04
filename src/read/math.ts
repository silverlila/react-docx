/** OMML: only an m:oMath made of m:r holding m:t, m:rPr or w:rPr maps to Math; docx.js's MathRun takes no
 *  run properties. Other OMML (fractions, scripts, m:oMathPara) has no relationships and is kept as
 *  RawXml. */

import type { AuthorNode } from "../tree/author";
import type { ReadContext } from "./context";
import { elementsOf, textOf, type XmlElement } from "../ooxml/xml";

const RUN_PROPERTIES = new Set(["m:rPr", "w:rPr"]);

const isPlainRun = (run: XmlElement): boolean =>
  run.name === "m:r" &&
  elementsOf(run).every((child) => RUN_PROPERTIES.has(child.name) || (child.name === "m:t" && elementsOf(child).length === 0));

export const isPlainMath = (oMath: XmlElement): boolean => elementsOf(oMath).every(isPlainRun);

export function readMath(oMath: XmlElement, ctx: ReadContext): AuthorNode | null {
  if (!isPlainMath(oMath)) return null;
  const children: AuthorNode[] = [];
  for (const run of elementsOf(oMath)) {
    let text = "";
    for (const child of elementsOf(run)) {
      if (child.name === "m:t") text += textOf(child);
      else ctx.report({ kind: "dropped", element: child.name, detail: "MathRun takes no properties" });
    }
    if (text !== "") children.push({ type: "MathRun", props: {}, children: [text] });
  }
  return { type: "Math", props: {}, children };
}
