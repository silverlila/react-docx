/** m:oMath → Math holding MathRuns, when it is plain runs of text.
 *
 *  - Plain means: every child of the m:oMath is an m:r, and every child of an m:r is m:t, m:rPr or w:rPr.
 *    Any other structure (fractions, scripts, m:oMathPara, …) is not a Math the tree can hold, so the
 *    caller keeps it through the generic fallback as RawXml; OMML carries no relationships.
 *  - MathRun takes no properties, so m:rPr and w:rPr are dropped. An m:r with no text is left out. */

import type { AuthorNode } from "../tree/author";
import type { ReadContext } from "./context";
import { elementsOf, textOf, type XmlElement } from "../ooxml/xml";

const RUN_PROPERTIES = new Set(["m:rPr", "w:rPr"]);

const isPlainRun = (run: XmlElement): boolean =>
  run.name === "m:r" &&
  elementsOf(run).every((child) => RUN_PROPERTIES.has(child.name) || (child.name === "m:t" && elementsOf(child).length === 0));

export const isPlainMath = (oMath: XmlElement): boolean => elementsOf(oMath).every(isPlainRun);

/** The Math node of a plain m:oMath, or null when it is not plain. */
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
