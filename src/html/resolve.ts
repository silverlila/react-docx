/** resolveDocument: a canonical tree → plain data the preview draws, with the formatting Word would apply
 *  to each block and run already computed (decision 13).
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
 *  - Accepted preview simplifications, each noted at its site: no conditional table-style formatting, no
 *    toggle-property semantics, no font fallback lists. Insertions show as plain text; deletions, comments
 *    and comment marks are not drawn (Out of Scope).
 *  - Paths are canonical tree paths: child indices from the Document root. */

import type * as docx from "docx";
import { levelOf, markerText, type Counters } from "../ooxml/markers";
import type { RunOptions } from "../ooxml/run";
import type { TreePath } from "../read/diagnostics";
import type { ChildKind, DocumentNode, Node } from "../schema/elements";
import { own } from "../schema/own";
import { xmlRoots } from "../tree/xml-roots";
import { effectiveSheet, styleChain, type EffectiveSheet, type SheetParagraph } from "./sheet";

export type ComputedRun = {
  readonly fontFamily: string;
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
};

export type ComputedBorder = {
  readonly style: "solid" | "double" | "dashed" | "dotted";
  readonly widthPt: number;
  readonly color: string;
};

type Side = "top" | "bottom" | "left" | "right";

export type ComputedParagraph = {
  readonly align: "left" | "center" | "right" | "justify" | "start" | "end";
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
  readonly markRun: ComputedRun;
};

export type ResolvedInline =
  | { readonly kind: "text"; readonly text: string; readonly run: ComputedRun }
  | { readonly kind: "tab" | "lineBreak" | "pageBreak" | "columnBreak" }
  | { readonly kind: "field"; readonly placeholder: string; readonly run: ComputedRun }
  | {
      readonly kind: "image";
      readonly src: string;
      readonly widthPx: number;
      readonly heightPx: number;
      readonly alt: string;
      readonly floating: boolean;
    }
  | { readonly kind: "link"; readonly href: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "anchor"; readonly id: string; readonly inlines: readonly ResolvedInline[] }
  | { readonly kind: "footnoteRef"; readonly n: number; readonly run: ComputedRun }
  | { readonly kind: "raw"; readonly element: string };

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
      readonly widthPt: number | null;
      readonly columnWidthsPt: readonly number[];
      readonly rows: readonly ResolvedRow[];
    }
  | {
      readonly kind: "textbox";
      readonly path: TreePath;
      readonly widthPt: number | null;
      readonly heightPt: number | null;
      readonly blocks: readonly ResolvedBlock[];
    }
  | { readonly kind: "raw"; readonly path: TreePath; readonly element: string };

export type ResolvedRow = { readonly heightPt: number | null; readonly isHeader: boolean; readonly cells: readonly ResolvedCell[] };

export type ResolvedCell = {
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly widthPt: number | null;
  readonly background: string | null;
  readonly borders: ComputedParagraph["borders"];
  readonly verticalAlign: "top" | "center" | "bottom";
  readonly blocks: readonly ResolvedBlock[];
};

export type ResolvedFootnote = { readonly n: number; readonly blocks: readonly ResolvedBlock[] };

export type ResolvedSection = {
  readonly path: TreePath;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly marginsPt: Readonly<Record<"top" | "right" | "bottom" | "left", number>>;
  readonly header: readonly ResolvedBlock[];
  readonly body: readonly ResolvedBlock[];
  readonly footer: readonly ResolvedBlock[];
  readonly footnotes: readonly ResolvedFootnote[];
};

type BlockNode = Node<"Paragraph" | "Table" | "RawXml" | "TableOfContents" | "Textbox">;
type InlineNode = Node<ChildKind<"Paragraph">>;
type RunChild = Node<ChildKind<"TextRun">> | string;
type Levels = readonly docx.ILevelsOptions[];
type Measure = number | string;
type FontSlot = "ascii" | "hAnsi" | "eastAsia" | "cs";
type FontSlots = Partial<Record<FontSlot, string>>;

/** The formatting a table's style gives the paragraphs and runs in its cells. */
type TableLayer = { readonly paragraph: SheetParagraph; readonly run: RunOptions };

type DocumentScope = {
  readonly sheet: EffectiveSheet;
  readonly levels: ReadonlyMap<string, Levels>;
  readonly bodyCounters: Counters;
  nextFootnote(): number;
};

/** One flow of text: a section's body, a header, a footer or a footnote. */
type Story = {
  readonly doc: DocumentScope;
  readonly counters: Counters;
  /** The section's footnotes, appended to as body paragraphs reference them. */
  readonly footnotes: ResolvedFootnote[];
  readonly table: TableLayer | null;
};

/** What inline content inherits from its paragraph. */
type InlineScope = { readonly story: Story; readonly run: RunOptions };

/** The OOXML application defaults, used when nothing sets a run's font or size. */
export const FALLBACK_RUN = { font: "Times New Roman", size: 20 } as const;

/** docx.js's section defaults (sectionPageSizeDefaults, sectionMarginDefaults), in twips. */
const PAGE_DEFAULTS = { width: 11906, height: 16838, top: 1440, right: 1440, bottom: 1440, left: 1440 } as const;

/** The border docx.js writes for each table side not given (DEFAULT_BORDER in TableBorders). */
const DOCX_TABLE_BORDER: docx.IBorderOptions = { style: "single", size: 4, color: "auto" };

/** Word draws a border with no w:sz at its thinnest, 2 eighths of a point. */
const THINNEST_BORDER = 2;

const TWIPS_PER_PT = 20;
const HALF_POINTS_PER_PT = 2;
const EIGHTHS_PER_PT = 8;
const LINE_UNITS = 240;
const BASE64_CHUNK = 0x8000;
const FONT_SLOTS: readonly FontSlot[] = ["ascii", "hAnsi", "eastAsia", "cs"];
const POINTS_PER_UNIT: Readonly<Record<string, number>> = { pt: 1, pc: 12, pi: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };
const UNIVERSAL_MEASURE = /^(-?[0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|pi)$/;
const POINT_LENGTH = /^(-?[0-9]+(?:\.[0-9]+)?)pt$/;
const HEX = /^[0-9A-Fa-f]{6}$/;

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

const BORDER_STYLES: Readonly<Record<string, ComputedBorder["style"] | null>> = {
  single: "solid",
  double: "double",
  dashed: "dashed",
  dotted: "dotted",
  nil: null,
  none: null,
};

/** Word's highlight palette. */
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

// ── Units ────────────────────────────────────────────────────────────────────────────────────────────

/** A docx.js measure in points: a number in `perPoint` units (twips, half-points, …) or a universal
 *  measure string ("12pt", "2cm"). */
function pointsOf(value: Measure, perPoint: number): number {
  if (typeof value === "number") return value / perPoint;
  const match = UNIVERSAL_MEASURE.exec(value);
  if (match === null) throw new Error(`resolveDocument: "${value}" is not a number or a universal measure`);
  return Number(match[1]) * POINTS_PER_UNIT[match[2]];
}

/** A colour docx.js wrote, or null for "auto", which Word draws as the automatic colour. */
const hexOrNull = (color: string | undefined): string | null => (color !== undefined && HEX.test(color) ? color : null);

/** The colour a w:shd shows: a solid pattern shows its pattern colour, any other its fill. */
function shadingColor(shading: docx.IShadingAttributesProperties | undefined): string | null {
  if (shading === undefined || shading.type === "nil") return null;
  return shading.type === "solid" ? hexOrNull(shading.color) : hexOrNull(shading.fill);
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

// ── The cascade ──────────────────────────────────────────────────────────────────────────────────────

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

/** `over` on top of `base`. Plain override precedence: Word's toggle properties (bold in a character
 *  style flipping the paragraph style's bold) are not modeled, a preview simplification. */
function overRun(base: RunOptions, over: RunOptions | undefined): RunOptions {
  if (over === undefined) return base;
  if (base.font === undefined && over.font === undefined) return { ...base, ...over };
  return { ...base, ...over, font: { ...fontSlots(base.font), ...fontSlots(over.font) } };
}

type Indent = NonNullable<SheetParagraph["indent"]>;

/** `start` and `end` are the newer names of `left` and `right`. */
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

function overParagraph(base: SheetParagraph, over: SheetParagraph | undefined): SheetParagraph {
  if (over === undefined) return base;
  return {
    ...base,
    ...over,
    spacing: { ...base.spacing, ...over.spacing },
    indent: { ...indentOf(base.indent), ...indentOf(over.indent) },
  };
}

function computeRun(run: RunOptions): ComputedRun {
  const font = fontSlots(run.font);
  const underline = run.underline === undefined ? null : run.underline.type ?? "single";
  const highlight = run.highlight === undefined ? undefined : own(HIGHLIGHTS, run.highlight);
  return {
    // A single family, with no fallback list: a preview simplification.
    fontFamily: font.ascii ?? font.hAnsi ?? FALLBACK_RUN.font,
    sizePt: pointsOf(run.size ?? FALLBACK_RUN.size, HALF_POINTS_PER_PT),
    bold: run.bold ?? false,
    italic: run.italics ?? false,
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
  };
}

function lineHeightOf(spacing: SheetParagraph["spacing"]): ComputedParagraph["lineHeight"] {
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

function computeParagraph(p: SheetParagraph, markRun: ComputedRun): ComputedParagraph {
  const indent = p.indent ?? {};
  const firstLine =
    indent.hanging !== undefined ? -pointsOf(indent.hanging, TWIPS_PER_PT) : pointsOf(indent.firstLine ?? 0, TWIPS_PER_PT);
  return {
    align: (p.alignment === undefined ? undefined : own(ALIGNMENTS, p.alignment)) ?? "left",
    spaceBeforePt: (p.spacing?.before ?? 0) / TWIPS_PER_PT,
    spaceAfterPt: (p.spacing?.after ?? 0) / TWIPS_PER_PT,
    lineHeight: lineHeightOf(p.spacing),
    indentLeftPt: pointsOf(indent.left ?? 0, TWIPS_PER_PT),
    indentRightPt: pointsOf(indent.right ?? 0, TWIPS_PER_PT),
    firstLinePt: firstLine,
    borders: computeBorders(p.border ?? {}),
    background: shadingColor(p.shading),
    pageBreakBefore: p.pageBreakBefore ?? false,
    markRun,
  };
}

/** The run options every run of a story inherits before its paragraph style. */
function storyRun(story: Story): RunOptions {
  return overRun(story.doc.sheet.docDefaults.run, story.table?.run);
}

/** The character style chain's run options over `base`. */
function withCharacterStyle(base: RunOptions, style: string | undefined, sheet: EffectiveSheet): RunOptions {
  return styleChain(sheet, style).reduce((run, s) => overRun(run, s.run), base);
}

/** A run's computed formatting: its paragraph's, then its character style chain, then its own props. */
function runOf(scope: InlineScope, props: RunOptions): ComputedRun {
  return computeRun(overRun(withCharacterStyle(scope.run, props.style, scope.story.doc.sheet), props));
}

// ── Inlines ──────────────────────────────────────────────────────────────────────────────────────────

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

const repeat = <T>(count: number, item: T): T[] => Array.from({ length: count }, () => item);

function runContent(child: RunChild, run: ComputedRun): ResolvedInline[] {
  if (typeof child === "string") return [{ kind: "text", text: child, run }];
  switch (child.type) {
    case "Tab":
    case "PositionalTab":
      return [{ kind: "tab" }];
    case "CarriageReturn":
      return [{ kind: "lineBreak" }];
    case "SoftHyphen":
      return [{ kind: "text", text: "­", run }];
    case "NoBreakHyphen":
      return [{ kind: "text", text: "‑", run }];
    case "PageNumber":
      return [{ kind: "field", placeholder: "#", run }];
    case "DayShort":
    case "DayLong":
    case "MonthShort":
    case "MonthLong":
    case "YearShort":
    case "YearLong":
      return [{ kind: "field", placeholder: "date", run }];
    case "RawXml":
      return [{ kind: "raw", element: firstRoot(child.props.xml) }];
    case "CommentReference":
      return [];
    default: {
      const exhaustive: never = child;
      throw new Error(`resolveDocument: unknown run content ${JSON.stringify(exhaustive)}`);
    }
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

function image(props: Node<"ImageRun">["props"]): ResolvedInline {
  const alt = props.altText;
  return {
    kind: "image",
    src: `data:${IMAGE_MEDIA_TYPES[props.type]};base64,${base64(props.data)}`,
    widthPx: props.transformation.width,
    heightPx: props.transformation.height,
    alt: alt?.description ?? alt?.title ?? alt?.name ?? "",
    floating: !!props.floating,
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
      return [{ kind: "pageBreak" }];
    case "ColumnBreak":
      return [{ kind: "columnBreak" }];
    case "SymbolRun": {
      const { char, symbolfont, ...props } = node.props;
      const run = runOf(scope, { ...props, font: symbolfont ?? "Wingdings" });
      return [{ kind: "text", text: String.fromCodePoint(parseInt(char, 16)), run }];
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
      return [{ kind: "text", text, run: computeRun(overRun(scope.run, { italics: true })) }];
    }
    case "Footnote": {
      const n = scope.story.doc.nextFootnote();
      const story: Story = { ...scope.story, counters: new Map(), table: null };
      scope.story.footnotes.push({ n, blocks: blocksOf(node.children, at, story) });
      const run = computeRun(withCharacterStyle(scope.run, "FootnoteReference", sheet));
      return [{ kind: "footnoteRef", n, run }];
    }
    case "SimpleField":
      return [{ kind: "text", text: node.props.cachedValue ?? "", run: computeRun(scope.run) }];
    case "SimpleMailMergeField":
      return [{ kind: "text", text: `«${node.props.fieldName}»`, run: computeRun(scope.run) }];
    case "SequentialIdentifier":
    case "PageReference":
      return [{ kind: "field", placeholder: "#", run: computeRun(scope.run) }];
    case "CheckBox":
      return [{ kind: "text", text: node.props.checked ? "☒" : "☐", run: computeRun(scope.run) }];
    case "RawXml":
      return [{ kind: "raw", element: firstRoot(node.props.xml) }];
    default: {
      const exhaustive: never = node;
      throw new Error(`resolveDocument: unknown inline ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ── Blocks ───────────────────────────────────────────────────────────────────────────────────────────

type Numbering = { readonly reference: string; readonly level: number; readonly instance?: number };

function marker(numbering: Numbering, markRun: RunOptions, story: Story): ResolvedMarker | null {
  const levels = story.doc.levels.get(numbering.reference);
  if (levels === undefined) return null;
  const level = levelOf(levels, numbering.level);
  const key = `${numbering.reference}:${numbering.instance ?? 0}`;
  return {
    text: markerText(levels, story.counters, key, numbering.level),
    run: computeRun(overRun(markRun, level?.style?.run)),
    suffix: level?.suffix ?? "tab",
  };
}

function paragraph(node: Node<"Paragraph">, path: TreePath, story: Story): ResolvedBlock {
  const { props } = node;
  const { sheet } = story.doc;
  const chain = styleChain(sheet, props.style ?? sheet.defaultParagraphStyle);
  const styled = chain.reduce(
    (p, s) => overParagraph(p, s.paragraph),
    overParagraph(sheet.docDefaults.paragraph, story.table?.paragraph)
  );
  const numbering = props.numbering !== undefined ? props.numbering : styled.numbering;
  const level = numbering ? levelOf(story.doc.levels.get(numbering.reference) ?? [], numbering.level) : undefined;
  const format = overParagraph(overParagraph(styled, level?.style?.paragraph), props);
  const run = chain.reduce((r, s) => overRun(r, s.run), storyRun(story));
  const markRun = overRun(run, props.run);
  return {
    kind: "paragraph",
    path,
    format: computeParagraph(format, computeRun(markRun)),
    marker: numbering ? marker(numbering, markRun, story) : null,
    inlines: inlinesOf(node.children, path, { story, run }),
  };
}

type TableBorderSide = keyof docx.ITableBordersOptions;
type PlacedCell = { readonly cell: Node<"TableCell">; readonly index: number; readonly gridCol: number; readonly colSpan: number };
type Span = { readonly colSpan: number; readonly rows: number };

/** Each row's cells with their grid column. A cell with an authored rowSpan covers its grid columns in
 *  the rows below, where docx.js inserts continuation cells. */
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

/** 1 + the directly following rows whose cell at `gridCol` continues a vertical merge. */
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

function tableLayer(table: Node<"Table">, story: Story): TableLayer {
  // The table style's paragraph and run options only: its conditional formatting (w:tblStylePr, first
  // row, banding, …) is not applied, a preview simplification.
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
  const columns = Math.max(columnWidths.length, ...grid.map((row) => row.reduce((n, p) => Math.max(n, p.gridCol + p.colSpan), 0)));
  const cellStory: Story = { ...story, table: tableLayer(node, story) };
  const lastRow = grid.length - 1;
  const rows = node.children.map((row, r): ResolvedRow => {
    const cells = grid[r].flatMap(({ cell, index, gridCol, colSpan }): ResolvedCell[] => {
      const { props } = cell;
      if (props.verticalMerge === "continue") return [];
      const rowSpan = (props.rowSpan ?? 1) > 1 ? props.rowSpan ?? 1 : props.verticalMerge === "restart" ? mergedRows(grid, r, gridCol) : 1;
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
    widthPt: widthPtOf(node.props.width),
    columnWidthsPt: columnWidths.map((w) => w / TWIPS_PER_PT),
    rows,
  };
}

/** A VML length in points, when it is given in points. */
function pointLength(length: unknown): number | null {
  if (typeof length !== "string") return null;
  const match = POINT_LENGTH.exec(length);
  return match === null ? null : Number(match[1]);
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
        widthPt: pointLength(node.props.style?.width),
        heightPt: pointLength(node.props.style?.height),
        blocks: blocksOf(node.children, path, story),
      };
    default: {
      const exhaustive: never = node;
      throw new Error(`resolveDocument: unknown block ${JSON.stringify(exhaustive)}`);
    }
  }
}

function blocksOf(children: readonly BlockNode[], at: TreePath, story: Story): ResolvedBlock[] {
  return children.map((child, i) => block(child, [...at, i], story));
}

// ── Sections ─────────────────────────────────────────────────────────────────────────────────────────

function pageOf(section: Node<"Section">): Pick<ResolvedSection, "widthPt" | "heightPt" | "marginsPt"> {
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
    },
  };
}

function section(node: Node<"Section">, path: TreePath, doc: DocumentScope): ResolvedSection {
  const footnotes: ResolvedFootnote[] = [];
  const body: ResolvedBlock[] = [];
  let header: ResolvedBlock[] = [];
  let footer: ResolvedBlock[] = [];
  const ownStory = (): Story => ({ doc, counters: new Map(), footnotes, table: null });
  node.children.forEach((child, i) => {
    const at = [...path, i];
    // Only the default header and footer are shown (Out of Scope).
    if (child.type === "Header") {
      if (child.props.type === "default") header = blocksOf(child.children, at, ownStory());
    } else if (child.type === "Footer") {
      if (child.props.type === "default") footer = blocksOf(child.children, at, ownStory());
    } else {
      body.push(block(child, at, { doc, counters: doc.bodyCounters, footnotes, table: null }));
    }
  });
  return { path, ...pageOf(node), header, body, footer, footnotes };
}

export function resolveDocument(document: DocumentNode): readonly ResolvedSection[] {
  let footnotes = 0;
  const doc: DocumentScope = {
    sheet: effectiveSheet(document.props.styles),
    levels: new Map((document.props.numbering?.config ?? []).map((c) => [c.reference, c.levels])),
    bodyCounters: new Map(),
    nextFootnote: () => ++footnotes,
  };
  return document.children.flatMap((child, i) => (child.type === "Section" ? [section(child, [i], doc)] : []));
}
