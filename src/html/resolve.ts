/** resolveSections: a canonical tree → its sections as plain data the preview draws (model.ts), with the
 *  formatting Word would apply to each block and run already computed.
 *
 *  - The cascade, lowest first. Paragraph: document defaults, the enclosing table's style, the paragraph
 *    style chain (`style`, else the default paragraph style), the numbering level, direct props. Run:
 *    document defaults, the table style, the paragraph style chain, the character style chain
 *    (`TextRun.style`), direct props. `spacing`, `indent` and `font` merge per key; everything else
 *    overrides.
 *  - When nothing sets a font or size, FALLBACK_RUN applies: the OOXML application defaults.
 *  - Table borders: docx.js writes w:tblBorders on every table, with a single 4-eighths border on each side
 *    the table does not give, so the table style's own borders never show in Word; those sides are drawn.
 *  - Page geometry falls back to docx.js's section defaults (A4, 1440-twip margins), and a landscape
 *    page's visible width is `size.height`, because docx.js swaps the two on write.
 *  - List markers count per story: the body of every section shares one set of counters, and each header,
 *    footer and footnote counts on its own. Footnotes are numbered 1..n in body order across the document
 *    and collected under the section that references them.
 *  - Word draws a border that has no w:sz at its thinnest, 2 eighths of a point.
 *  - docx.js inserts continuation cells in the rows below a cell with an authored rowSpan.
 *  - docx.js writes a pct width of N as N%. Its TextWrappingType is numeric: 0 none, 1 square, 2 tight,
 *    3 top and bottom; the preview draws tight as square. A VML length with no unit is px at 96 dpi.
 *  - Word sets each line at its tallest run's single-line height times the multiple, or at least the
 *    paragraph's minimum. An exact line is fixed, and runs inherit it.
 *  - Word's defaults: a tab stop every 0.5in, 0.5in between columns, cell margins of 0.075in left and
 *    right. An automatic shading fill is none (white under a pattern), an automatic pattern colour is
 *    black, and pctN covers N% (stripes and crosses their average cover).
 *  - In a right-to-left paragraph Word reads left and right as start and end, and sets a right-to-left
 *    run in its complex-script font, size, bold and italic.
 *  - Word drops a contextual-spacing paragraph's space before (after) when the paragraph before (after)
 *    has the same style, and draws consecutive paragraphs with the same borders and indents as one box:
 *    the top border above the first only, the bottom border below the last only.
 *  - Accepted preview simplifications: no conditional table-style formatting, no toggle-property
 *    semantics, no font fallback lists. Insertions show as plain text; deletions, comments and comment
 *    marks are not drawn. */

import type * as docx from "docx";
import { HEX } from "../ooxml/codec";
import { levelOf, markerText, type Counters } from "../ooxml/markers";
import type { RunOptions } from "../ooxml/run";
import type { TreePath } from "../read/diagnostics";
import type { ChildKind, DocumentNode, Node, Props } from "../schema/elements";
import { VML_MEASURE } from "../schema/docx-facts";
import { own } from "../schema/own";
import { xmlRoots } from "../tree/xml-roots";
import { lineHeightOf } from "./fonts";
import type {
  ComputedBorder,
  ComputedParagraph,
  ComputedRun,
  FieldKind,
  HeaderFooterType,
  PageGeometry,
  ResolvedBlock,
  ResolvedCell,
  ResolvedColumns,
  ResolvedFloat,
  ResolvedFootnote,
  ResolvedInline,
  ResolvedMarker,
  ResolvedRow,
  ResolvedSection,
  Side,
  TabStop,
} from "./model";
import { rawBlocks, rawInlines, rawRunItems, type RunItem } from "./raw";
import { effectiveSheet, styleChain, type EffectiveSheet, type SheetParagraph } from "./sheet";

type BlockNode = Node<"Paragraph" | "Table" | "RawXml" | "TableOfContents" | "Textbox">;
type InlineNode = Node<ChildKind<"Paragraph">>;
type RunChild = Node<ChildKind<"TextRun">> | string;
type Levels = readonly docx.ILevelsOptions[];
type Measure = number | string;
type FontSlot = "ascii" | "hAnsi" | "eastAsia" | "cs";
type FontSlots = Partial<Record<FontSlot, string>>;

type TableLayer = { readonly paragraph: SheetParagraph; readonly run: RunOptions };

type DocumentScope = {
  readonly sheet: EffectiveSheet;
  readonly defaultTabPt: number;
  readonly levels: ReadonlyMap<string, Levels>;
  readonly bodyCounters: Counters;
  nextFootnote(): number;
};

type Story = {
  readonly doc: DocumentScope;
  readonly counters: Counters;
  readonly footnotes: ResolvedFootnote[];
  readonly table: TableLayer | null;
};

type LineRule = ComputedParagraph["lineHeight"];

type InlineScope = {
  readonly story: Story;
  readonly run: RunOptions;
  readonly line: LineRule;
  readonly tocEntry: boolean;
};

const TOC_ENTRY_STYLE = /^TOC[1-9]$/i;
const HYPERLINK_STYLE = "Hyperlink";

const FALLBACK_RUN = { font: "Times New Roman", size: 20 } as const;

const PAGE_DEFAULTS = {
  width: 11906,
  height: 16838,
  top: 1440,
  right: 1440,
  bottom: 1440,
  left: 1440,
  header: 708,
  footer: 708,
} as const;

const DEFAULT_TAB_STOP = 720;

const DEFAULT_COLUMN_SPACE = 720;

const DOCX_TABLE_BORDER: docx.IBorderOptions = { style: "single", size: 4, color: "auto" };

const THINNEST_BORDER = 2;

const TWIPS_PER_PT = 20;
const HALF_POINTS_PER_PT = 2;
const EIGHTHS_PER_PT = 8;
const LINE_UNITS = 240;
const BASE64_CHUNK = 0x8000;
const FONT_SLOTS: readonly FontSlot[] = ["ascii", "hAnsi", "eastAsia", "cs"];
const POINTS_PER_UNIT: Readonly<Record<string, number>> = {
  pt: 1,
  pc: 12,
  pi: 12,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
};
const UNIVERSAL_MEASURE = /^(-?[0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|pi)$/;

const ALIGNMENTS: Readonly<Record<string, ComputedParagraph["align"]>> = {
  left: "left",
  start: "start",
  center: "center",
  right: "right",
  end: "end",
  both: "justify",
  distribute: "justify",
  mediumKashida: "justify",
  highKashida: "justify",
  lowKashida: "justify",
  thaiDistribute: "justify",
};

function alignOf(alignment: string | undefined, rtl: boolean): ComputedParagraph["align"] {
  const align = (alignment === undefined ? undefined : own(ALIGNMENTS, alignment)) ?? "left";
  if (align === "left") return rtl ? "start" : "left";
  if (align === "right") return rtl ? "end" : "right";
  return align;
}

const BORDER_STYLES: Readonly<Record<string, ComputedBorder["style"] | null>> = {
  single: "solid",
  double: "double",
  dashed: "dashed",
  dotted: "dotted",
  nil: null,
  none: null,
};

const HIGHLIGHTS: Readonly<Record<string, string>> = {
  black: "000000",
  blue: "0000FF",
  cyan: "00FFFF",
  green: "00FF00",
  magenta: "FF00FF",
  red: "FF0000",
  yellow: "FFFF00",
  white: "FFFFFF",
  darkBlue: "000080",
  darkCyan: "008080",
  darkGreen: "008000",
  darkMagenta: "800080",
  darkRed: "800000",
  darkYellow: "808000",
  darkGray: "808080",
  lightGray: "C0C0C0",
};

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function pointsOf(value: Measure, perPoint: number): number {
  if (typeof value === "number") return value / perPoint;
  const match = UNIVERSAL_MEASURE.exec(value);
  if (match === null) throw new Error(`resolveDocument: "${value}" is not a number or a universal measure`);
  return Number(match[1]) * POINTS_PER_UNIT[match[2]];
}

const hexOrNull = (color: string | undefined): string | null => (color !== undefined && HEX.test(color) ? color : null);

function patternCover(type: string | undefined): number {
  if (type === undefined || type === "clear") return 0;
  if (type === "solid") return 1;
  const pct = /^pct(\d+)$/.exec(type);
  if (pct !== null) return Number(pct[1]) / 100;
  return type.startsWith("thin") ? 0.25 : 0.5;
}

function mix(foreground: string, background: string, cover: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [0, 2, 4]
    .map((i) =>
      Math.round(channel(background, i) * (1 - cover) + channel(foreground, i) * cover)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

function shadingColor(shading: docx.IShadingAttributesProperties | undefined): string | null {
  if (shading === undefined || shading.type === "nil") return null;
  const fill = hexOrNull(shading.fill);
  const cover = patternCover(shading.type);
  if (cover === 0) return fill;
  return mix(hexOrNull(shading.color) ?? "000000", fill ?? "FFFFFF", cover);
}

function computeBorder(border: docx.IBorderOptions | undefined): ComputedBorder | null {
  if (border === undefined) return null;
  const style = own(BORDER_STYLES, border.style);
  if (style === null) return null;
  return {
    style: style ?? "solid",
    widthPt: (border.size ?? THINNEST_BORDER) / EIGHTHS_PER_PT,
    color: hexOrNull(border.color) ?? "000000",
  };
}

function computeBorders(sides: Partial<Record<Side, docx.IBorderOptions>>): ComputedParagraph["borders"] {
  const out: Partial<Record<Side, ComputedBorder>> = {};
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const border = computeBorder(sides[side]);
    if (border !== null) out[side] = border;
  }
  return out;
}

function fontSlots(font: RunOptions["font"]): FontSlots {
  if (font === undefined) return {};
  if (typeof font === "string") return { ascii: font, hAnsi: font, eastAsia: font, cs: font };
  if ("name" in font) return { ascii: font.name, hAnsi: font.name, eastAsia: font.name, cs: font.name };
  const slots: FontSlots = {};
  for (const slot of FONT_SLOTS) {
    const name = font[slot];
    if (name !== undefined) slots[slot] = name;
  }
  return slots;
}

function overRun(base: RunOptions, over: RunOptions | undefined): RunOptions {
  if (over === undefined) return base;
  if (base.font === undefined && over.font === undefined) return { ...base, ...over };
  return { ...base, ...over, font: { ...fontSlots(base.font), ...fontSlots(over.font) } };
}

type Indent = NonNullable<SheetParagraph["indent"]>;

function indentOf(indent: Indent | undefined): Indent {
  if (indent === undefined) return {};
  const left = indent.left ?? indent.start;
  const right = indent.right ?? indent.end;
  return {
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    ...(indent.hanging === undefined ? {} : { hanging: indent.hanging }),
    ...(indent.firstLine === undefined ? {} : { firstLine: indent.firstLine }),
  };
}

type TabStops = NonNullable<SheetParagraph["tabStops"]>;

function overTabStops(base: TabStops | undefined, over: TabStops | undefined): TabStops | undefined {
  if (over === undefined) return base;
  const at = new Map((base ?? []).map((stop) => [stop.position, stop]));
  for (const stop of over) {
    if (stop.type === "clear") at.delete(stop.position);
    else at.set(stop.position, stop);
  }
  return [...at.values()];
}

function overParagraph(base: SheetParagraph, over: SheetParagraph | undefined): SheetParagraph {
  if (over === undefined) return base;
  const tabStops = overTabStops(base.tabStops, over.tabStops);
  return {
    ...base,
    ...over,
    spacing: { ...base.spacing, ...over.spacing },
    indent: { ...indentOf(base.indent), ...indentOf(over.indent) },
    ...(tabStops === undefined ? {} : { tabStops }),
  };
}

const TAB_ALIGNS: Readonly<Record<string, TabStop["align"]>> = {
  left: "left",
  start: "left",
  right: "right",
  end: "right",
  center: "center",
  decimal: "decimal",
};

const TAB_LEADERS: ReadonlySet<string> = new Set(["dot", "hyphen", "underscore", "heavy", "middleDot"]);

function computeTabStops(stops: TabStops | undefined, indentLeftPt: number, firstLinePt: number): TabStop[] {
  const out: TabStop[] = [];
  for (const stop of stops ?? []) {
    const align = own(TAB_ALIGNS, stop.type);
    if (align === undefined) continue;
    const leader =
      stop.leader !== undefined && TAB_LEADERS.has(stop.leader) ? (stop.leader as TabStop["leader"]) : "none";
    out.push({ posPt: pointsOf(stop.position, TWIPS_PER_PT) - indentLeftPt, align, leader });
  }
  if (firstLinePt < 0 && !out.some((stop) => Math.abs(stop.posPt) < 0.01))
    out.push({ posPt: 0, align: "left", leader: "none" });
  return out.sort((a, b) => a.posPt - b.posPt);
}

function runLineHeight(fontFamily: string, line: LineRule): number | null {
  if (line.kind === "exact") return null;
  return lineHeightOf(fontFamily) * (line.kind === "multiple" ? line.value : 1);
}

function computeRun(run: RunOptions, line: LineRule): ComputedRun {
  const font = fontSlots(run.font);
  const rtl = run.rightToLeft ?? false;
  const latin = font.ascii ?? font.hAnsi;
  const fontFamily = (rtl ? (font.cs ?? latin) : latin) ?? FALLBACK_RUN.font;
  const otherFonts = [latin, font.eastAsia, font.cs].filter((f): f is string => f !== undefined && f !== fontFamily);
  const size =
    rtl && run.sizeComplexScript !== undefined && typeof run.sizeComplexScript !== "boolean"
      ? run.sizeComplexScript
      : run.size;
  const underline = run.underline === undefined ? null : (run.underline.type ?? "single");
  const highlight = run.highlight === undefined ? undefined : own(HIGHLIGHTS, run.highlight);
  return {
    fontFamily,
    otherFonts: [...new Set(otherFonts)],
    rtl,
    sizePt: pointsOf(size ?? FALLBACK_RUN.size, HALF_POINTS_PER_PT),
    bold: (rtl ? (run.boldComplexScript ?? run.bold) : run.bold) ?? false,
    italic: (rtl ? (run.italicsComplexScript ?? run.italics) : run.italics) ?? false,
    underline: underline === "none" ? null : underline,
    strike: run.strike ?? false,
    doubleStrike: run.doubleStrike ?? false,
    color: hexOrNull(run.color),
    highlight: highlight ?? null,
    background: shadingColor(run.shading),
    allCaps: run.allCaps ?? false,
    smallCaps: run.smallCaps ?? false,
    verticalAlign: run.superScript ? "super" : run.subScript ? "sub" : null,
    letterSpacingPt: (run.characterSpacing ?? 0) / TWIPS_PER_PT,
    hidden: run.vanish ?? false,
    lineHeight: runLineHeight(fontFamily, line),
  };
}

function lineRuleOf(spacing: SheetParagraph["spacing"]): LineRule {
  const line = spacing?.line;
  if (line === undefined) return { kind: "multiple", value: 1 };
  switch (spacing?.lineRule) {
    case "exact":
    case "exactly":
      return { kind: "exact", pt: line / TWIPS_PER_PT };
    case "atLeast":
      return { kind: "atLeast", pt: line / TWIPS_PER_PT };
    default:
      return { kind: "multiple", value: line / LINE_UNITS };
  }
}

function computeParagraph(
  p: SheetParagraph,
  markRun: ComputedRun,
  styleId: string | null,
  defaultTabPt: number,
): ComputedParagraph {
  const indent = p.indent ?? {};
  const firstLine =
    indent.hanging !== undefined
      ? -pointsOf(indent.hanging, TWIPS_PER_PT)
      : pointsOf(indent.firstLine ?? 0, TWIPS_PER_PT);
  return {
    align: alignOf(p.alignment, p.bidirectional ?? false),
    rtl: p.bidirectional ?? false,
    spaceBeforePt: (p.spacing?.before ?? 0) / TWIPS_PER_PT,
    spaceAfterPt: (p.spacing?.after ?? 0) / TWIPS_PER_PT,
    lineHeight: lineRuleOf(p.spacing),
    indentLeftPt: pointsOf(indent.left ?? 0, TWIPS_PER_PT),
    indentRightPt: pointsOf(indent.right ?? 0, TWIPS_PER_PT),
    firstLinePt: firstLine,
    borders: computeBorders(p.border ?? {}),
    background: shadingColor(p.shading),
    pageBreakBefore: p.pageBreakBefore ?? false,
    keepNext: p.keepNext ?? false,
    keepLines: p.keepLines ?? false,
    widowControl: p.widowControl ?? false,
    markRun,
    tabStops: computeTabStops(p.tabStops, pointsOf(indent.left ?? 0, TWIPS_PER_PT), firstLine),
    defaultTabPt,
    styleId,
    contextualSpacing: p.contextualSpacing ?? false,
  };
}

function storyRun(story: Story): RunOptions {
  return overRun(story.doc.sheet.docDefaults.run, story.table?.run);
}

function withCharacterStyle(base: RunOptions, style: string | undefined, sheet: EffectiveSheet): RunOptions {
  return styleChain(sheet, style).reduce((run, s) => overRun(run, s.run), base);
}

function runOf(scope: InlineScope, props: RunOptions): ComputedRun {
  const style = scope.tocEntry && props.style === HYPERLINK_STYLE ? undefined : props.style;
  return computeRun(overRun(withCharacterStyle(scope.run, style, scope.story.doc.sheet), props), scope.line);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function firstRoot(xml: string): string {
  const roots = xmlRoots(xml);
  if (roots.kind !== "roots" || roots.roots.length === 0) {
    throw new Error(`resolveDocument: RawXml is not canonical (${roots.kind === "roots" ? "no root" : roots.reason})`);
  }
  return roots.roots[0];
}

const PAGE_FIELDS: Readonly<Record<Node<"PageNumber">["props"]["field"], FieldKind>> = {
  CURRENT: "page",
  TOTAL_PAGES: "numPages",
  TOTAL_PAGES_IN_SECTION: "sectionPages",
  SECTION: "section",
};

const rawInline = (element: string): ResolvedInline =>
  element === "w:lastRenderedPageBreak" ? { kind: "pageBreak", rendered: true } : { kind: "raw", element };

const repeat = <T>(count: number, item: T): T[] => Array.from({ length: count }, () => item);

function runContent(child: RunChild, run: ComputedRun): ResolvedInline[] {
  if (typeof child === "string") return [{ kind: "text", text: child, run }];
  switch (child.type) {
    case "Tab":
    case "PositionalTab":
      return [{ kind: "tab", run }];
    case "CarriageReturn":
      return [{ kind: "lineBreak" }];
    case "SoftHyphen":
      return [{ kind: "text", text: "­", run }];
    case "NoBreakHyphen":
      return [{ kind: "text", text: "‑", run }];
    case "PageNumber":
      return [{ kind: "field", field: PAGE_FIELDS[child.props.field], placeholder: "#", run }];
    case "DayShort":
    case "DayLong":
    case "MonthShort":
    case "MonthLong":
    case "YearShort":
    case "YearLong":
      return [{ kind: "field", field: "date", placeholder: "date", run }];
    case "RawXml": {
      const shown = rawRunItems(child.props.xml);
      return shown.length > 0
        ? shown.flatMap((item) => rawRunItem(item, run))
        : [rawInline(firstRoot(child.props.xml))];
    }
    case "CommentReference":
      return [];
    default: {
      const exhaustive: never = child;
      throw new Error(`resolveDocument: unknown run content ${JSON.stringify(exhaustive)}`);
    }
  }
}

const symbolText = (char: string): string => String.fromCodePoint(parseInt(char, 16));

function rawRunItem(item: RunItem, run: ComputedRun): ResolvedInline[] {
  if (typeof item === "string") return runContent(item, run);
  switch (item.type) {
    case "PageBreak":
      return [{ kind: "pageBreak", rendered: false }];
    case "ColumnBreak":
      return [{ kind: "columnBreak" }];
    case "SymbolRun":
      return [
        {
          kind: "text",
          text: symbolText(item.props.char),
          run: { ...run, fontFamily: item.props.symbolfont ?? "Wingdings", otherFonts: [] },
        },
      ];
    case "RawXml":
      return [rawInline(firstRoot(item.props.xml))];
    default:
      return runContent(item, run);
  }
}

function textRun(node: Node<"TextRun" | "InsertedTextRun">, scope: InlineScope): ResolvedInline[] {
  const run = runOf(scope, node.props);
  const { text } = node.props;
  return [
    ...repeat<ResolvedInline>(node.props.break ?? 0, { kind: "lineBreak" }),
    ...(text === undefined ? [] : [{ kind: "text" as const, text, run }]),
    ...node.children.flatMap((child) => runContent(child, run)),
  ];
}

const EMU_PER_PT = 12700;

const H_ALIGNS: Readonly<Record<string, ResolvedFloat["horizontal"]["align"]>> = {
  left: "left",
  inside: "left",
  center: "center",
  right: "right",
  outside: "right",
};

const V_ALIGNS: Readonly<Record<string, ResolvedFloat["vertical"]["align"]>> = {
  top: "top",
  inside: "top",
  center: "center",
  bottom: "bottom",
  outside: "bottom",
};

const WRAPS: readonly ResolvedFloat["wrap"][] = ["none", "square", "square", "topAndBottom"];

function floatOf(floating: NonNullable<Node<"ImageRun">["props"]["floating"]>): ResolvedFloat {
  const h = floating.horizontalPosition;
  const v = floating.verticalPosition;
  const margins = floating.margins ?? {};
  return {
    wrap: WRAPS[floating.wrap?.type ?? 0] ?? "none",
    behind: floating.behindDocument ?? false,
    horizontal: {
      from: h.relative === "page" || h.relative === "leftMargin" || h.relative === "insideMargin" ? "page" : "margin",
      align: h.align === undefined ? null : (own(H_ALIGNS, h.align) ?? null),
      offsetPt: (h.offset ?? 0) / EMU_PER_PT,
    },
    vertical: {
      from:
        v.relative === "page" || v.relative === "topMargin" ? "page" : v.relative === "margin" ? "margin" : "paragraph",
      align: v.align === undefined ? null : (own(V_ALIGNS, v.align) ?? null),
      offsetPt: (v.offset ?? 0) / EMU_PER_PT,
    },
    distancePt: {
      top: (margins.top ?? 0) / EMU_PER_PT,
      bottom: (margins.bottom ?? 0) / EMU_PER_PT,
      left: (margins.left ?? 0) / EMU_PER_PT,
      right: (margins.right ?? 0) / EMU_PER_PT,
    },
  };
}

function image(props: Node<"ImageRun">["props"]): ResolvedInline {
  const alt = props.altText;
  return {
    kind: "image",
    src: `data:${IMAGE_MEDIA_TYPES[props.type]};base64,${base64(props.data)}`,
    widthPx: props.transformation.width,
    heightPx: props.transformation.height,
    alt: alt?.description ?? alt?.title ?? alt?.name ?? "",
    float: props.floating === undefined ? null : floatOf(props.floating),
  };
}

function inlinesOf(children: readonly InlineNode[], at: TreePath, scope: InlineScope): ResolvedInline[] {
  return children.flatMap((child, i) => inline(child, [...at, i], scope));
}

function inline(node: InlineNode, at: TreePath, scope: InlineScope): ResolvedInline[] {
  const { sheet } = scope.story.doc;
  switch (node.type) {
    case "TextRun":
    case "InsertedTextRun":
      return textRun(node, scope);
    case "DeletedTextRun":
    case "CommentRangeStart":
    case "CommentRangeEnd":
      return [];
    case "PageBreak":
      return [{ kind: "pageBreak", rendered: false }];
    case "ColumnBreak":
      return [{ kind: "columnBreak" }];
    case "SymbolRun": {
      const { char, symbolfont, ...props } = node.props;
      const run = runOf(scope, { ...props, font: symbolfont ?? "Wingdings" });
      return [{ kind: "text", text: symbolText(char), run }];
    }
    case "ImageRun":
      return [image(node.props)];
    case "ExternalHyperlink":
      return [{ kind: "link", href: node.props.link, inlines: inlinesOf(node.children, at, scope) }];
    case "InternalHyperlink":
      return [{ kind: "link", href: `#${node.props.anchor}`, inlines: inlinesOf(node.children, at, scope) }];
    case "Bookmark":
      return [{ kind: "anchor", id: node.props.id, inlines: inlinesOf(node.children, at, scope) }];
    case "Math": {
      const text = node.children.map((mathRun) => mathRun.children.join("")).join("");
      return [{ kind: "text", text, run: computeRun(overRun(scope.run, { italics: true }), scope.line) }];
    }
    case "Footnote": {
      const n = scope.story.doc.nextFootnote();
      const story: Story = { ...scope.story, counters: new Map(), table: null };
      scope.story.footnotes.push({ n, blocks: blocksOf(node.children, at, story) });
      const run = computeRun(withCharacterStyle(scope.run, "FootnoteReference", sheet), scope.line);
      return [{ kind: "footnoteRef", n, run }];
    }
    case "SimpleField":
      return [{ kind: "text", text: node.props.cachedValue ?? "", run: computeRun(scope.run, scope.line) }];
    case "SimpleMailMergeField":
      return [{ kind: "text", text: `«${node.props.fieldName}»`, run: computeRun(scope.run, scope.line) }];
    case "SequentialIdentifier":
    case "PageReference":
      return [{ kind: "field", field: "ref", placeholder: "#", run: computeRun(scope.run, scope.line) }];
    case "CheckBox":
      return [{ kind: "text", text: node.props.checked ? "☒" : "☐", run: computeRun(scope.run, scope.line) }];
    case "RawXml": {
      const shown = rawInlines(node.props.xml);
      return shown.length > 0 ? inlinesOf(shown, at, scope) : [rawInline(firstRoot(node.props.xml))];
    }
    default: {
      const exhaustive: never = node;
      throw new Error(`resolveDocument: unknown inline ${JSON.stringify(exhaustive)}`);
    }
  }
}

type Numbering = { readonly reference: string; readonly level: number; readonly instance?: number };

function marker(numbering: Numbering, markRun: RunOptions, story: Story, line: LineRule): ResolvedMarker | null {
  const levels = story.doc.levels.get(numbering.reference);
  if (levels === undefined) return null;
  const level = levelOf(levels, numbering.level);
  const key = `${numbering.reference}:${numbering.instance ?? 0}`;
  return {
    text: markerText(levels, story.counters, key, numbering.level),
    run: computeRun(overRun(markRun, level?.style?.run), line),
    suffix: level?.suffix ?? "tab",
  };
}

function paragraph(node: Node<"Paragraph">, path: TreePath, story: Story): ResolvedBlock {
  const { props } = node;
  const { sheet } = story.doc;
  const styleId = props.style ?? sheet.defaultParagraphStyle;
  const chain = styleChain(sheet, styleId);
  const styled = chain.reduce(
    (p, s) => overParagraph(p, s.paragraph),
    overParagraph(sheet.docDefaults.paragraph, story.table?.paragraph),
  );
  const numbering = props.numbering !== undefined ? props.numbering : styled.numbering;
  const level = numbering ? levelOf(story.doc.levels.get(numbering.reference) ?? [], numbering.level) : undefined;
  const format = overParagraph(overParagraph(styled, level?.style?.paragraph), props);
  const run = chain.reduce((r, s) => overRun(r, s.run), storyRun(story));
  const markRun = overRun(run, props.run);
  const line = lineRuleOf(format.spacing);
  return {
    kind: "paragraph",
    path,
    format: computeParagraph(format, computeRun(markRun, line), styleId, story.doc.defaultTabPt),
    marker: numbering ? marker(numbering, markRun, story, line) : null,
    inlines: inlinesOf(node.children, path, {
      story,
      run,
      line,
      tocEntry: styleId !== null && TOC_ENTRY_STYLE.test(styleId),
    }),
  };
}

type TableBorderSide = keyof docx.ITableBordersOptions;
type PlacedCell = {
  readonly cell: Node<"TableCell">;
  readonly index: number;
  readonly gridCol: number;
  readonly colSpan: number;
};
type Span = { readonly colSpan: number; readonly rows: number };

function placeCells(rows: readonly Node<"TableRow">[]): PlacedCell[][] {
  let covering = new Map<number, Span>();
  return rows.map((row) => {
    const next = new Map<number, Span>();
    for (const [col, span] of covering) if (span.rows > 1) next.set(col, { ...span, rows: span.rows - 1 });
    const placed: PlacedCell[] = [];
    let col = 0;
    row.children.forEach((cell, index) => {
      for (let span = covering.get(col); span !== undefined; span = covering.get(col)) col += span.colSpan;
      const colSpan = cell.props.columnSpan ?? 1;
      const rowSpan = cell.props.rowSpan ?? 1;
      if (rowSpan > 1) next.set(col, { colSpan, rows: rowSpan - 1 });
      placed.push({ cell, index, gridCol: col, colSpan });
      col += colSpan;
    });
    covering = next;
    return placed;
  });
}

function mergedRows(grid: readonly PlacedCell[][], rowIndex: number, gridCol: number): number {
  let span = 1;
  for (const row of grid.slice(rowIndex + 1)) {
    const below = row.find((placed) => placed.gridCol === gridCol);
    if (below?.cell.props.verticalMerge !== "continue") break;
    span++;
  }
  return span;
}

const widthPtOf = (width: docx.ITableWidthProperties | undefined): number | null =>
  width !== undefined && (width.type === undefined || width.type === "dxa") && typeof width.size === "number"
    ? width.size / TWIPS_PER_PT
    : null;

function widthPctOf(width: docx.ITableWidthProperties | undefined): number | null {
  if (width?.type !== "pct") return null;
  const pct = typeof width.size === "number" ? width.size : parseFloat(width.size);
  return Number.isFinite(pct) ? pct : null;
}

type CellMargins = docx.ITableCellOptions["margins"];

const DEFAULT_CELL_MARGINS: Readonly<Record<Side, number>> = { top: 0, right: 108, bottom: 0, left: 108 };

function cellPadding(cell: CellMargins, table: CellMargins): Readonly<Record<Side, number>> {
  const side = (s: Side) => (cell?.[s] ?? table?.[s] ?? DEFAULT_CELL_MARGINS[s]) / TWIPS_PER_PT;
  return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
}

function tableLayer(table: Node<"Table">, story: Story): TableLayer {
  const { sheet } = story.doc;
  const chain = styleChain(sheet, table.props.style);
  return {
    paragraph: chain.reduce((p, s) => overParagraph(p, s.paragraph), {}),
    run: chain.reduce((r, s) => overRun(r, s.run), {}),
  };
}

function table(node: Node<"Table">, path: TreePath, story: Story): ResolvedBlock {
  const sides: Record<TableBorderSide, docx.IBorderOptions> = {
    top: node.props.borders?.top ?? DOCX_TABLE_BORDER,
    bottom: node.props.borders?.bottom ?? DOCX_TABLE_BORDER,
    left: node.props.borders?.left ?? DOCX_TABLE_BORDER,
    right: node.props.borders?.right ?? DOCX_TABLE_BORDER,
    insideHorizontal: node.props.borders?.insideHorizontal ?? DOCX_TABLE_BORDER,
    insideVertical: node.props.borders?.insideVertical ?? DOCX_TABLE_BORDER,
  };
  const grid = placeCells(node.children);
  const columnWidths = node.props.columnWidths ?? [];
  const columns = Math.max(
    columnWidths.length,
    ...grid.map((row) => row.reduce((n, p) => Math.max(n, p.gridCol + p.colSpan), 0)),
  );
  const cellStory: Story = { ...story, table: tableLayer(node, story) };
  const lastRow = grid.length - 1;
  const rows = node.children.map((row, r): ResolvedRow => {
    const cells = grid[r].flatMap(({ cell, index, gridCol, colSpan }): ResolvedCell[] => {
      const { props } = cell;
      if (props.verticalMerge === "continue") return [];
      const rowSpan =
        (props.rowSpan ?? 1) > 1
          ? (props.rowSpan ?? 1)
          : props.verticalMerge === "restart"
            ? mergedRows(grid, r, gridCol)
            : 1;
      const own = props.borders ?? {};
      const borders = computeBorders({
        top: own.top ?? (r === 0 ? sides.top : sides.insideHorizontal),
        bottom: own.bottom ?? (r + rowSpan - 1 >= lastRow ? sides.bottom : sides.insideHorizontal),
        left: own.left ?? own.start ?? (gridCol === 0 ? sides.left : sides.insideVertical),
        right: own.right ?? own.end ?? (gridCol + colSpan >= columns ? sides.right : sides.insideVertical),
      });
      return [
        {
          colSpan,
          rowSpan,
          widthPt: widthPtOf(props.width),
          paddingPt: cellPadding(props.margins, node.props.margins),
          background: shadingColor(props.shading),
          borders,
          verticalAlign: props.verticalAlign ?? "top",
          blocks: blocksOf(cell.children, [...path, r, index], cellStory),
        },
      ];
    });
    const height = row.props.height;
    return {
      heightPt: height === undefined ? null : pointsOf(height.value, TWIPS_PER_PT),
      isHeader: row.props.tableHeader ?? false,
      cells,
    };
  });
  return {
    kind: "table",
    path,
    rtl: node.props.visuallyRightToLeft ?? false,
    widthPt: widthPtOf(node.props.width),
    widthPct: widthPctOf(node.props.width),
    indentPt: widthPtOf(node.props.indent) ?? 0,
    align:
      node.props.alignment === "center"
        ? "center"
        : node.props.alignment === "right" || node.props.alignment === "end"
          ? "end"
          : "start",
    fixed: node.props.layout === "fixed",
    columnWidthsPt: columnWidths.map((w) => w / TWIPS_PER_PT),
    rows,
  };
}

function vmlLength(length: unknown): number | null {
  if (typeof length === "number") return length * 0.75;
  if (typeof length !== "string") return null;
  const match = VML_MEASURE.exec(length);
  const perUnit = match === null ? undefined : own(POINTS_PER_UNIT, match[2]);
  return match === null || perUnit === undefined ? null : Number(match[1]) * perUnit;
}

const VML_ALIGNS: Readonly<Record<string, "left" | "center" | "right">> = {
  left: "left",
  center: "center",
  right: "right",
  inside: "left",
  outside: "right",
};
const VML_V_ALIGNS: Readonly<Record<string, "top" | "center" | "bottom">> = {
  top: "top",
  center: "center",
  bottom: "bottom",
  inside: "top",
  outside: "bottom",
};

function textboxFloat(style: Props<"Textbox">["style"]): ResolvedFloat | null {
  if (style?.position !== "absolute") return null;
  const offset = (margin: unknown, plain: unknown) => (vmlLength(margin) ?? 0) + (vmlLength(plain) ?? 0);
  const hAlign = style.positionHorizontal === undefined ? null : (own(VML_ALIGNS, style.positionHorizontal) ?? null);
  const vAlign = style.positionVertical === undefined ? null : (own(VML_V_ALIGNS, style.positionVertical) ?? null);
  const zIndex = typeof style.zIndex === "number" ? style.zIndex : 0;
  return {
    wrap: "none",
    behind: zIndex < 0,
    horizontal: {
      from: style.positionHorizontalRelative === "page" ? "page" : "margin",
      align: hAlign,
      offsetPt: offset(style.marginLeft, style.left),
    },
    vertical: {
      from:
        style.positionVerticalRelative === "page"
          ? "page"
          : style.positionVerticalRelative === "margin"
            ? "margin"
            : "paragraph",
      align: vAlign,
      offsetPt: offset(style.marginTop, style.top),
    },
    distancePt: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function block(node: BlockNode, path: TreePath, story: Story): ResolvedBlock {
  switch (node.type) {
    case "Paragraph":
      return paragraph(node, path, story);
    case "Table":
      return table(node, path, story);
    case "RawXml":
      return { kind: "raw", path, element: firstRoot(node.props.xml) };
    case "TableOfContents":
      return { kind: "raw", path, element: "w:sdt" };
    case "Textbox":
      return {
        kind: "textbox",
        path,
        widthPt: vmlLength(node.props.style?.width),
        heightPt: vmlLength(node.props.style?.height),
        float: textboxFloat(node.props.style),
        rotation: node.props.style?.rotation ?? 0,
        blocks: blocksOf(node.children, path, story),
      };
    default: {
      const exhaustive: never = node;
      throw new Error(`resolveDocument: unknown block ${JSON.stringify(exhaustive)}`);
    }
  }
}

function blocksFor(node: BlockNode, path: TreePath, story: Story): ResolvedBlock[] {
  if (node.type !== "RawXml") return [block(node, path, story)];
  const shown = rawBlocks(node.props.xml);
  return shown.length > 0 ? shown.map((child) => block(child, path, story)) : [block(node, path, story)];
}

function blocksOf(children: readonly BlockNode[], at: TreePath, story: Story): ResolvedBlock[] {
  return adjacency(children.flatMap((child, i) => blocksFor(child, [...at, i], story)));
}

function inFlow(blocks: readonly ResolvedBlock[], i: number, step: 1 | -1): ResolvedBlock | undefined {
  for (let j = i + step; j >= 0 && j < blocks.length; j += step) {
    const b = blocks[j];
    if (!(b.kind === "textbox" && b.float !== null)) return b;
  }
  return undefined;
}

const adjacency = (blocks: ResolvedBlock[]): ResolvedBlock[] => withBorderGroups(withContextualSpacing(blocks));

const sameBorder = (a: ComputedBorder | undefined, b: ComputedBorder | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.style === b.style && a.widthPt === b.widthPt && a.color === b.color);

function withBorderGroups(blocks: ResolvedBlock[]): ResolvedBlock[] {
  const grouped = (a: ResolvedBlock | undefined, b: ResolvedBlock | undefined): boolean => {
    if (!isParagraph(a) || !isParagraph(b)) return false;
    const [x, y] = [a.format, b.format];
    if (Object.keys(x.borders).length === 0) return false;
    return (
      (["top", "bottom", "left", "right"] as const).every((side) => sameBorder(x.borders[side], y.borders[side])) &&
      x.indentLeftPt === y.indentLeftPt &&
      x.indentRightPt === y.indentRightPt
    );
  };
  return blocks.map((b, i) => {
    if (!isParagraph(b)) return b;
    const after = grouped(b, inFlow(blocks, i, 1));
    const before = grouped(inFlow(blocks, i, -1), b);
    if (!after && !before) return b;
    const { top, bottom, ...sides } = b.format.borders;
    const borders = {
      ...sides,
      ...(before || top === undefined ? {} : { top }),
      ...(after || bottom === undefined ? {} : { bottom }),
    };
    return { ...b, format: { ...b.format, borders } };
  });
}

type ParagraphBlock = Extract<ResolvedBlock, { kind: "paragraph" }>;

const isParagraph = (b: ResolvedBlock | undefined): b is ParagraphBlock => b?.kind === "paragraph";

function withContextualSpacing(blocks: ResolvedBlock[]): ResolvedBlock[] {
  return blocks.map((b, i) => {
    if (!isParagraph(b) || !b.format.contextualSpacing) return b;
    const same = (other: ResolvedBlock | undefined) => isParagraph(other) && other.format.styleId === b.format.styleId;
    const before = same(inFlow(blocks, i, -1)) ? 0 : b.format.spaceBeforePt;
    const after = same(inFlow(blocks, i, 1)) ? 0 : b.format.spaceAfterPt;
    if (before === b.format.spaceBeforePt && after === b.format.spaceAfterPt) return b;
    return { ...b, format: { ...b.format, spaceBeforePt: before, spaceAfterPt: after } };
  });
}

function pageOf(section: Node<"Section">): PageGeometry {
  const page = section.props.properties?.page;
  const size = page?.size;
  const width = pointsOf(size?.width ?? PAGE_DEFAULTS.width, TWIPS_PER_PT);
  const height = pointsOf(size?.height ?? PAGE_DEFAULTS.height, TWIPS_PER_PT);
  const landscape = size?.orientation === "landscape";
  const margin = page?.margin;
  return {
    widthPt: landscape ? height : width,
    heightPt: landscape ? width : height,
    marginsPt: {
      top: pointsOf(margin?.top ?? PAGE_DEFAULTS.top, TWIPS_PER_PT),
      right: pointsOf(margin?.right ?? PAGE_DEFAULTS.right, TWIPS_PER_PT),
      bottom: pointsOf(margin?.bottom ?? PAGE_DEFAULTS.bottom, TWIPS_PER_PT),
      left: pointsOf(margin?.left ?? PAGE_DEFAULTS.left, TWIPS_PER_PT),
      header: pointsOf(margin?.header ?? PAGE_DEFAULTS.header, TWIPS_PER_PT),
      footer: pointsOf(margin?.footer ?? PAGE_DEFAULTS.footer, TWIPS_PER_PT),
    },
  };
}

function columnsOf(section: Node<"Section">): ResolvedColumns | null {
  const column = section.props.properties?.column;
  const count = column?.count ?? 1;
  if (count <= 1) return null;
  return {
    count,
    spacePt: pointsOf(column?.space ?? DEFAULT_COLUMN_SPACE, TWIPS_PER_PT),
    separate: column?.separate ?? false,
  };
}

function section(node: Node<"Section">, path: TreePath, doc: DocumentScope): ResolvedSection {
  const footnotes: ResolvedFootnote[] = [];
  const body: ResolvedBlock[] = [];
  const headers: Partial<Record<HeaderFooterType, readonly ResolvedBlock[]>> = {};
  const footers: Partial<Record<HeaderFooterType, readonly ResolvedBlock[]>> = {};
  const ownStory = (): Story => ({ doc, counters: new Map(), footnotes, table: null });
  node.children.forEach((child, i) => {
    const at = [...path, i];
    if (child.type === "Header") {
      headers[child.props.type] = blocksOf(child.children, at, ownStory());
    } else if (child.type === "Footer") {
      footers[child.props.type] = blocksOf(child.children, at, ownStory());
    } else {
      body.push(...blocksFor(child, at, { doc, counters: doc.bodyCounters, footnotes, table: null }));
    }
  });
  const properties = node.props.properties;
  return {
    path,
    ...pageOf(node),
    continuous: properties?.type === "continuous",
    titlePage: properties?.titlePage ?? false,
    pageNumberStart: properties?.page?.pageNumbers?.start ?? null,
    pageNumberFormat: properties?.page?.pageNumbers?.formatType ?? "decimal",
    columns: columnsOf(node),
    headers,
    footers,
    body: adjacency(body),
    footnotes,
  };
}

export function resolveSections(document: DocumentNode): readonly ResolvedSection[] {
  let footnotes = 0;
  const doc: DocumentScope = {
    sheet: effectiveSheet(document.props.styles),
    defaultTabPt: pointsOf(document.props.defaultTabStop ?? DEFAULT_TAB_STOP, TWIPS_PER_PT),
    levels: new Map((document.props.numbering?.config ?? []).map((c) => [c.reference, c.levels])),
    bodyCounters: new Map(),
    nextFootnote: () => ++footnotes,
  };
  return document.children.flatMap((child, i) => (child.type === "Section" ? [section(child, [i], doc)] : []));
}
