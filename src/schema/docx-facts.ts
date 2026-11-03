import type * as docx from "docx";
import type { Kind } from "./elements";

/** Facts about docx.js 9.5.1's behavior that canonicalization depends on.
 *  Each one is pinned by test/presence-booleans.test.ts. */

/** Strings docx.js turns into fields when they are run children. Values of docx.PageNumber. */
export const PAGE_NUMBER_VALUES = ["CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", "SECTION"] as const;

type DefaultStyleKey = Exclude<keyof NonNullable<docx.IStylesOptions["default"]>, "document">;
type DefaultStyleSlot = { readonly key: DefaultStyleKey; readonly kind: "paragraph" | "character" };

/** docx.js's built-in style ids → their IDefaultStylesOptions key, and which kind of options that key takes. */
export const DEFAULT_STYLE_SLOTS = {
  Title: { key: "title", kind: "paragraph" },
  Heading1: { key: "heading1", kind: "paragraph" },
  Heading2: { key: "heading2", kind: "paragraph" },
  Heading3: { key: "heading3", kind: "paragraph" },
  Heading4: { key: "heading4", kind: "paragraph" },
  Heading5: { key: "heading5", kind: "paragraph" },
  Heading6: { key: "heading6", kind: "paragraph" },
  Strong: { key: "strong", kind: "paragraph" },
  ListParagraph: { key: "listParagraph", kind: "paragraph" },
  Hyperlink: { key: "hyperlink", kind: "character" },
  FootnoteReference: { key: "footnoteReference", kind: "character" },
  FootnoteText: { key: "footnoteText", kind: "paragraph" },
  FootnoteTextChar: { key: "footnoteTextChar", kind: "character" },
} as const satisfies Record<string, DefaultStyleSlot>;

/** Boolean options docx.js writes identically for `true` and `false`. Found by test/presence-booleans.test.ts.
 *  Paths are dot paths relative to the kind's props. */
export const PRESENCE_ONLY: { readonly [K in Kind]?: readonly string[] } = {};

/** The OOXML elements a RawXml fragment may hold at its top level, by the slot it stands in.
 *  `w:footnoteReference`, `w:endnoteReference` and `w:commentReference` are left out of `run`:
 *  their ids would point at notes the tree does not contain. */
export const RAW_XML_ROOTS = {
  block: ["w:p", "w:tbl", "w:sdt", "w:customXml", "w:bookmarkStart", "w:bookmarkEnd"],
  inline: [
    "w:r",
    "w:hyperlink",
    "w:sdt",
    "w:fldSimple",
    "w:ins",
    "w:del",
    "w:moveFrom",
    "w:moveTo",
    "w:bookmarkStart",
    "w:bookmarkEnd",
    "w:commentRangeStart",
    "w:commentRangeEnd",
    "w:smartTag",
    "w:customXml",
    "w:proofErr",
    "m:oMath",
    "m:oMathPara",
  ],
  run: [
    "w:t",
    "w:delText",
    "w:tab",
    "w:br",
    "w:cr",
    "w:fldChar",
    "w:instrText",
    "w:sym",
    "w:softHyphen",
    "w:noBreakHyphen",
    "w:ptab",
    "w:lastRenderedPageBreak",
    "w:separator",
    "w:continuationSeparator",
  ],
  style: ["w:style"],
} as const;
