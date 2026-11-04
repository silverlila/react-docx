/** The preview's data model: what resolveSections (resolve.ts) computes from a canonical tree, and what
 *  paginate (pages.ts), css.ts, tabs.ts and DocxPreview read. Types only, so every other module of the
 *  preview may import it and it imports none of them. Paths are canonical tree paths: child indices from
 *  the Document root. */

import type { TreePath } from "../read/diagnostics";

export type ComputedRun = {
  readonly fontFamily: string;
  /** The run's fonts for other scripts, for characters its own font lacks. */
  readonly otherFonts: readonly string[];
  /** Right-to-left text (w:rtl). */
  readonly rtl: boolean;
  readonly sizePt: number;
  readonly bold: boolean;
  readonly italic: boolean;
  /** The docx.js underline type ("single", "double", …), or null. */
  readonly underline: string | null;
  readonly strike: boolean;
  readonly doubleStrike: boolean;
  /** 6-digit hex without "#"; null is automatic (inherit). */
  readonly color: string | null;
  /** Word's highlight palette colour as hex. */
  readonly highlight: string | null;
  /** The run shading's colour as hex. */
  readonly background: string | null;
  readonly allCaps: boolean;
  readonly smallCaps: boolean;
  readonly verticalAlign: "super" | "sub" | null;
  readonly letterSpacingPt: number;
  readonly hidden: boolean;
  /** The run's own line height as a multiple of its size, from its paragraph's line rule; null inherits
   *  the paragraph's. */
  readonly lineHeight: number | null;
};

export type ComputedBorder = {
  readonly style: "solid" | "double" | "dashed" | "dotted";
  readonly widthPt: number;
  readonly color: string;
};

export type Side = "top" | "bottom" | "left" | "right";

export type ComputedParagraph = {
  readonly align: "left" | "center" | "right" | "justify" | "start" | "end";
  /** A right-to-left paragraph (w:bidi): its alignment and indents are logical, start being the right. */
  readonly rtl: boolean;
  readonly spaceBeforePt: number;
  readonly spaceAfterPt: number;
  readonly lineHeight:
    | { readonly kind: "multiple"; readonly value: number }
    | { readonly kind: "exact" | "atLeast"; readonly pt: number };
  readonly indentLeftPt: number;
  readonly indentRightPt: number;
  /** Negative is a hanging indent. */
  readonly firstLinePt: number;
  readonly borders: Partial<Record<Side, ComputedBorder>>;
  readonly background: string | null;
  readonly pageBreakBefore: boolean;
  /** Keep with the next paragraph on one page. */
  readonly keepNext: boolean;
  /** Keep all its lines on one page. */
  readonly keepLines: boolean;
  /** Leave no single line of it alone at the foot or head of a page. */
  readonly widowControl: boolean;
  readonly markRun: ComputedRun;
  /** Tab stops, relative to the left indent, in position order. */
  readonly tabStops: readonly TabStop[];
  readonly defaultTabPt: number;
  /** The paragraph style in effect, for contextual spacing. */
  readonly styleId: string | null;
  readonly contextualSpacing: boolean;
};

export type ResolvedInline =
  /** `at`: which text of its paragraph piece this is, and the offset its text starts at there, set by
   *  pagination so a page break found by measuring can name a character. */
  | { readonly kind: "text"; readonly text: string; readonly run: ComputedRun; readonly at?: readonly [number, number] }
  | { readonly kind: "lineBreak" | "columnBreak" }
  /** A tab, with its run's formatting: an underlined tab draws its gap underlined. */
  | { readonly kind: "tab"; readonly run: ComputedRun }
  /** `rendered`: where Word last broke the page on its own (w:lastRenderedPageBreak), not an authored break. */
  | { readonly kind: "pageBreak"; readonly rendered: boolean }
  | { readonly kind: "field"; readonly field: FieldKind; readonly placeholder: string; readonly run: ComputedRun }
  | {
      readonly kind: "image";
      readonly src: string;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly alt: string;
      /** How a floating picture sits on the page; null for a picture in line with the text. */
      readonly float: ResolvedFloat | null;
    }
  | { readonly kind: "link"; readonly href: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "anchor"; readonly id: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "footnoteRef"; readonly n: number; readonly run: ComputedRun }
  | { readonly kind: "raw"; readonly element: string };

/** A floating picture: its wrap, and where it sits. A horizontal position is from the page's left edge or
 *  the left margin; a vertical one from the page's top, the top margin, or the anchoring paragraph. Each
 *  is an offset in points or an alignment in its frame. */
export type ResolvedFloat = {
  readonly wrap: "none" | "square" | "topAndBottom";
  readonly behind: boolean;
  readonly horizontal: { readonly from: "page" | "margin"; readonly align: "left" | "center" | "right" | null; readonly offsetPt: number };
  readonly vertical: { readonly from: "page" | "margin" | "paragraph"; readonly align: "top" | "center" | "bottom" | null; readonly offsetPt: number };
  /** The space kept between the picture and wrapped text. */
  readonly distancePt: Readonly<Record<Side, number>>;
};

/** What a field shows: the page's number, the document's or section's page count, the section's number, or
 *  a value the preview does not compute (a date, a page reference). */
export type FieldKind = "page" | "numPages" | "sectionPages" | "section" | "date" | "ref";

export type ResolvedMarker = {
  readonly text: string;
  readonly run: ComputedRun;
  readonly suffix: "tab" | "space" | "nothing";
};

export type ResolvedBlock =
  | {
      readonly kind: "paragraph";
      readonly path: TreePath;
      readonly format: ComputedParagraph;
      readonly marker: ResolvedMarker | null;
      readonly inlines: readonly ResolvedInline[];
    }
  | {
      readonly kind: "table";
      readonly path: TreePath;
      /** A right-to-left table (w:bidiVisual): its columns run from the right, and left and right are
       *  start and end. */
      readonly rtl: boolean;
      readonly widthPt: number | null;
      /** A width as a percentage of the space the table stands in. */
      readonly widthPct: number | null;
      readonly indentPt: number;
      readonly align: "start" | "center" | "end";
      /** Fixed layout: columns keep their widths whatever their content. */
      readonly fixed: boolean;
      readonly columnWidthsPt: readonly number[];
      readonly rows: readonly ResolvedRow[];
    }
  | {
      readonly kind: "textbox";
      readonly path: TreePath;
      readonly widthPt: number | null;
      readonly heightPt: number | null;
      /** Where an absolutely positioned text box sits; null for one in the flow. */
      readonly float: ResolvedFloat | null;
      /** Clockwise, in degrees. */
      readonly rotation: number;
      readonly blocks: readonly ResolvedBlock[];
    }
  | { readonly kind: "raw"; readonly path: TreePath; readonly element: string };

export type ResolvedRow = { readonly heightPt: number | null; readonly isHeader: boolean; readonly cells: readonly ResolvedCell[] };

export type ResolvedCell = {
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly widthPt: number | null;
  readonly paddingPt: Readonly<Record<Side, number>>;
  readonly background: string | null;
  readonly borders: ComputedParagraph["borders"];
  readonly verticalAlign: "top" | "center" | "bottom";
  readonly blocks: readonly ResolvedBlock[];
};

export type ResolvedFootnote = { readonly n: number; readonly blocks: readonly ResolvedBlock[] };

export type PageGeometry = {
  readonly widthPt: number;
  readonly heightPt: number;
  /** header and footer: the distance from the page's top (bottom) edge to the header's top (footer's bottom). */
  readonly marginsPt: Readonly<Record<"top" | "right" | "bottom" | "left" | "header" | "footer", number>>;
};

export type ResolvedColumns = { readonly count: number; readonly spacePt: number; readonly separate: boolean };

export type HeaderFooterType = "default" | "first" | "even";

/** One section, resolved but not yet broken into pages (pages.ts does that). */
export type ResolvedSection = PageGeometry & {
  readonly path: TreePath;
  /** How the section starts: on a new page, or continuing the previous section's last page. */
  readonly continuous: boolean;
  readonly titlePage: boolean;
  /** The section's first page number, when it restarts numbering. */
  readonly pageNumberStart: number | null;
  readonly pageNumberFormat: string;
  readonly columns: ResolvedColumns | null;
  /** The section's own headers and footers, by type; a type it does not define is inherited (pages.ts). */
  readonly headers: Readonly<Partial<Record<HeaderFooterType, readonly ResolvedBlock[]>>>;
  readonly footers: Readonly<Partial<Record<HeaderFooterType, readonly ResolvedBlock[]>>>;
  readonly body: readonly ResolvedBlock[];
  readonly footnotes: readonly ResolvedFootnote[];
};

export type TabStop = {
  readonly posPt: number;
  readonly align: "left" | "center" | "right" | "decimal";
  readonly leader: "none" | "dot" | "hyphen" | "underscore" | "heavy" | "middleDot";
};
