/** Facts about docx.js 9.5.1's behaviour that canonicalization depends on.
 *
 *  - PAGE_NUMBER_VALUES: docx.PageNumber's values. docx.js turns these strings into fields when they are
 *    run children.
 *  - DEFAULT_STYLE_SLOTS: each of docx.js's built-in style ids, with the IDefaultStylesOptions key that
 *    sets it and whether that key takes paragraph or character options.
 *  - RAW_XML_ROOTS: the top-level OOXML elements a RawXml fragment may hold, by slot. */

import type * as docx from "docx";

export const PAGE_NUMBER_VALUES = ["CURRENT", "TOTAL_PAGES", "TOTAL_PAGES_IN_SECTION", "SECTION"] as const;

type DefaultStyleKey = Exclude<keyof NonNullable<docx.IStylesOptions["default"]>, "document">;
type DefaultStyleSlot = { readonly key: DefaultStyleKey; readonly kind: "paragraph" | "character" };

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
