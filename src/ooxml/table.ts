/** w:tblPr (with the sibling w:tblGrid), w:trPr and w:tcPr → docx.js table, row and cell options.
 *
 *  - The writer-inverse test defines correctness, as for runs and paragraphs.
 *  - Vertical merges read as verticalMerge on every w:tc, never as rowSpan: rowSpan makes docx.js invent
 *    continuation cells, so the cell count would change between reads.
 *  - Widths (w:tblW, w:tblInd, w:tcW): docx.js writes a number with type "pct" as that many percent, but
 *    Word's whole-number pct is fiftieths of a percent, so it reads as a percentage string ("100%"). A
 *    w:w that is already a percentage or a universal measure is kept as written. An absent w:type is
 *    the schema's "dxa", which docx.js would otherwise write as "auto".
 *  - docx.js writes w:tblOverlap inside w:tblpPr, where Word writes it beside it in w:tblPr. Both read as
 *    float.overlap; beside a table with no w:tblpPr it is dropped, because docx.js writes it only in one.
 *  - w:start and w:end are the newer names of the left and right sides, in borders and margins alike.
 *  - Cell margins share one unit in docx.js, so a side whose w:type differs from the first side's is
 *    dropped.
 *  - docx.js writes w:tblBorders on every table, with a single border for each side not given, so a
 *    side the file leaves to the table style comes back as a single border. No option can avoid it. */

import type * as docx from "docx";
import { attrOf, childNamed, elementsOf, type XmlElement } from "./xml";
import {
  applyFates,
  dropped,
  mapTo,
  oneOfAt,
  oneOfVal,
  onOff,
  readBorder,
  readShading,
  stringVal,
  wholeNumberAt,
  wholeNumberVal,
  HEIGHT_RULES,
  isUniversalMeasure,
  noOption,
  type CodecEnv,
  type CodecResult,
  type Draft,
  type Fate,
  type FateTable,
  type Note,
  type ValueOf,
  type ValueReader,
} from "./codec";

export type TableOptions = Omit<docx.ITableOptions, "rows">;
export type RowOptions = Omit<docx.ITableRowOptions, "children">;
export type CellOptions = Omit<docx.ITableCellOptions, "children">;

type WidthType = ValueOf<typeof docx.WidthType>;
type Measure = docx.ITableWidthProperties["size"];
type CellMargins = NonNullable<TableOptions["margins"]>;
type CellSpacing = NonNullable<TableOptions["cellSpacing"]>;

const WIDTH_TYPES: readonly WidthType[] = ["auto", "dxa", "nil", "pct"];
const CELL_SPACING_TYPES: readonly NonNullable<CellSpacing["type"]>[] = ["dxa"];
const TABLE_ALIGNMENTS: readonly ValueOf<typeof docx.AlignmentType>[] = ["start", "center", "end", "left", "right"];
const LAYOUTS: readonly ValueOf<typeof docx.TableLayoutType>[] = ["autofit", "fixed"];
const ANCHORS: readonly ValueOf<typeof docx.TableAnchorType>[] = ["margin", "page", "text"];
const HORIZONTAL_POSITIONS: readonly ValueOf<typeof docx.RelativeHorizontalPosition>[] = [
  "center",
  "inside",
  "left",
  "outside",
  "right",
];
const VERTICAL_POSITIONS: readonly ValueOf<typeof docx.RelativeVerticalPosition>[] = [
  "center",
  "inside",
  "bottom",
  "outside",
  "inline",
  "top",
];
const OVERLAPS: readonly ValueOf<typeof docx.OverlapType>[] = ["never", "overlap"];
const VERTICAL_MERGES: readonly ValueOf<typeof docx.VerticalMergeType>[] = ["continue", "restart"];
const CELL_VERTICAL_ALIGNS: readonly NonNullable<CellOptions["verticalAlign"]>[] = ["top", "center", "bottom"];
const TEXT_DIRECTIONS: readonly ValueOf<typeof docx.TextDirection>[] = ["btLr", "lrTb", "tbRl"];

const WHOLE_NUMBER = /^-?[0-9]+$/;
const PERCENT = /^-?[0-9]+(\.[0-9]+)?%$/;
const FIFTIETHS_PER_PERCENT = 50;


/** docx.js's twipsMeasureValue throws on a negative number, so one is dropped here instead. */
export function twipsAt(el: XmlElement, attribute: string, notes: Note[]): number | null {
  const value = wholeNumberAt(el, attribute, notes);
  if (value === null || value >= 0) return value;
  notes.push(dropped(el.name, `${attribute}="${value}" is negative, and docx.js writes only positive twips here`));
  return null;
}

function requiredAttribute(el: XmlElement, attribute: string, notes: Note[]): string | null {
  const value = attrOf(el, attribute);
  if (value === null) notes.push(dropped(el.name, `it has no ${attribute}`));
  return value;
}

/** A w:w measure: a whole number (fiftieths of a percent when the type is pct), a percentage or a
 *  universal measure. */
function measureAt(el: XmlElement, type: WidthType, notes: Note[]): Measure | null {
  const value = requiredAttribute(el, "w:w", notes);
  if (value === null) return null;
  if (PERCENT.test(value)) return `${Number(value.slice(0, -1))}%`;
  if (WHOLE_NUMBER.test(value)) return type === "pct" ? `${Number(value) / FIFTIETHS_PER_PERCENT}%` : Number(value);
  if (isUniversalMeasure(value)) return value;
  notes.push(dropped(el.name, `w:w="${value}" is not a measure docx.js writes`));
  return null;
}

/** w:type, or the schema's default "dxa" when it is absent; null (with a note) when docx.js rejects it. */
function widthTypeAt(el: XmlElement, notes: Note[]): WidthType | null {
  return attrOf(el, "w:type") === null ? "dxa" : oneOfAt(el, "w:type", WIDTH_TYPES, notes);
}

const readWidth: ValueReader<docx.ITableWidthProperties> = (el, _env, notes) => {
  const type = widthTypeAt(el, notes);
  if (type === null) return null;
  const size = measureAt(el, type, notes);
  return size === null ? null : { size, type };
};

const readCellSpacing: ValueReader<CellSpacing> = (el, _env, notes) => {
  const type = attrOf(el, "w:type") === null ? "dxa" : oneOfAt(el, "w:type", CELL_SPACING_TYPES, notes);
  if (type === null) return null;
  const value = measureAt(el, type, notes);
  return value === null ? null : { value, type };
};

/** docx.js types a cell margin as a number, written as that many percent when the unit is pct. */
function marginSizeAt(el: XmlElement, type: WidthType, notes: Note[]): number | null {
  const size = measureAt(el, type, notes);
  if (size === null || typeof size === "number") return size;
  if (type === "pct" && size.endsWith("%")) return Number(size.slice(0, -1));
  notes.push(dropped(el.name, `docx.js writes a ${type} cell margin only as a number, not ${size}`));
  return null;
}

const marginSide = (key: "top" | "bottom" | "left" | "right"): Fate<CellMargins> => ({
  fate: "mapped",
  read: (el, out, _env, notes) => {
    const type = widthTypeAt(el, notes);
    if (type === null) return;
    const size = marginSizeAt(el, type, notes);
    if (size === null) return;
    if (out.marginUnitType !== undefined && out.marginUnitType !== type) {
      notes.push(dropped(el.name, `docx.js writes one unit for all cell margins, here ${out.marginUnitType}`));
      return;
    }
    out.marginUnitType = type;
    out[key] = size;
  },
});

const MARGIN_FATES: FateTable<CellMargins> = {
  "w:top": marginSide("top"),
  "w:left": marginSide("left"),
  "w:start": marginSide("left"),
  "w:bottom": marginSide("bottom"),
  "w:right": marginSide("right"),
  "w:end": marginSide("right"),
};

const readMargins: ValueReader<CellMargins> = (el, env, notes) => {
  const read = applyFates(el, MARGIN_FATES, env);
  notes.push(...read.notes);
  return read.options.marginUnitType === undefined ? null : read.options;
};

const tableSide = (key: keyof docx.ITableBordersOptions) =>
  mapTo<docx.ITableBordersOptions, typeof key>(key, readBorder);

const TABLE_BORDER_FATES: FateTable<docx.ITableBordersOptions> = {
  "w:top": tableSide("top"),
  "w:left": tableSide("left"),
  "w:start": tableSide("left"),
  "w:bottom": tableSide("bottom"),
  "w:right": tableSide("right"),
  "w:end": tableSide("right"),
  "w:insideH": tableSide("insideHorizontal"),
  "w:insideV": tableSide("insideVertical"),
};

const cellSide = (key: keyof docx.ITableCellBorders) => mapTo<docx.ITableCellBorders, typeof key>(key, readBorder);

const CELL_BORDER_FATES: FateTable<docx.ITableCellBorders> = {
  "w:top": cellSide("top"),
  "w:start": cellSide("start"),
  "w:left": cellSide("left"),
  "w:bottom": cellSide("bottom"),
  "w:end": cellSide("end"),
  "w:right": cellSide("right"),
  "w:insideH": noOption("docx.js cell borders have no insideH side"),
  "w:insideV": noOption("docx.js cell borders have no insideV side"),
  "w:tl2br": noOption("docx.js cell borders have no diagonal"),
  "w:tr2bl": noOption("docx.js cell borders have no diagonal"),
};

const bordersOf =
  <B>(table: FateTable<B>): ValueReader<Draft<B>> =>
  (el, env, notes) => {
    const read = applyFates(el, table, env);
    notes.push(...read.notes);
    return Object.keys(read.options).length === 0 ? null : read.options;
  };

const readFloat: ValueReader<docx.ITableFloatOptions> = (el, _env, notes) => {
  const float: Draft<docx.ITableFloatOptions> = {};
  const horizontalAnchor = oneOfAt(el, "w:horzAnchor", ANCHORS, notes);
  if (horizontalAnchor !== null) float.horizontalAnchor = horizontalAnchor;
  const verticalAnchor = oneOfAt(el, "w:vertAnchor", ANCHORS, notes);
  if (verticalAnchor !== null) float.verticalAnchor = verticalAnchor;
  const absoluteHorizontalPosition = wholeNumberAt(el, "w:tblpX", notes);
  if (absoluteHorizontalPosition !== null) float.absoluteHorizontalPosition = absoluteHorizontalPosition;
  const absoluteVerticalPosition = wholeNumberAt(el, "w:tblpY", notes);
  if (absoluteVerticalPosition !== null) float.absoluteVerticalPosition = absoluteVerticalPosition;
  const relativeHorizontalPosition = oneOfAt(el, "w:tblpXSpec", HORIZONTAL_POSITIONS, notes);
  if (relativeHorizontalPosition !== null) float.relativeHorizontalPosition = relativeHorizontalPosition;
  const relativeVerticalPosition = oneOfAt(el, "w:tblpYSpec", VERTICAL_POSITIONS, notes);
  if (relativeVerticalPosition !== null) float.relativeVerticalPosition = relativeVerticalPosition;
  const leftFromText = twipsAt(el, "w:leftFromText", notes);
  if (leftFromText !== null) float.leftFromText = leftFromText;
  const rightFromText = twipsAt(el, "w:rightFromText", notes);
  if (rightFromText !== null) float.rightFromText = rightFromText;
  const topFromText = twipsAt(el, "w:topFromText", notes);
  if (topFromText !== null) float.topFromText = topFromText;
  const bottomFromText = twipsAt(el, "w:bottomFromText", notes);
  if (bottomFromText !== null) float.bottomFromText = bottomFromText;
  const overlap = readOverlap(childNamed(el, "w:tblOverlap"), notes);
  if (overlap !== null) float.overlap = overlap;
  return float;
};

function readOverlap(el: XmlElement | null, notes: Note[]): ValueOf<typeof docx.OverlapType> | null {
  return el === null ? null : oneOfAt(el, "w:val", OVERLAPS, notes);
}

const to = <K extends keyof TableOptions>(key: K, read: ValueReader<NonNullable<Draft<TableOptions>[K]>>) =>
  mapTo<TableOptions, K>(key, read);

/** Read after the other children, from w:tblPr, because it belongs to w:tblpPr's float. */
const READ_AFTER: Fate<TableOptions> = { fate: "mapped", read: () => undefined };

export const TBLPR_FATES: FateTable<TableOptions> = {
  "w:tblStyle": to("style", stringVal),
  "w:tblpPr": to("float", readFloat),
  "w:tblOverlap": READ_AFTER,
  "w:bidiVisual": to("visuallyRightToLeft", onOff(true)),
  "w:tblStyleRowBandSize": noOption("docx.js has no table-style band size option"),
  "w:tblStyleColBandSize": noOption("docx.js has no table-style band size option"),
  "w:tblW": to("width", readWidth),
  "w:jc": to("alignment", oneOfVal(TABLE_ALIGNMENTS)),
  "w:tblCellSpacing": to("cellSpacing", readCellSpacing),
  "w:tblInd": to("indent", readWidth),
  "w:tblBorders": to("borders", bordersOf(TABLE_BORDER_FATES)),
  "w:shd": noOption("docx.js tables have no shading option"),
  "w:tblLayout": {
    fate: "mapped",
    read: (el, out, _env, notes) => {
      const layout = oneOfAt(el, "w:type", LAYOUTS, notes);
      if (layout !== null) out.layout = layout;
    },
  },
  "w:tblCellMar": to("margins", readMargins),
  "w:tblLook": noOption("docx.js has no option for conditional table-style formatting"),
  "w:tblCaption": noOption("docx.js has no table caption option"),
  "w:tblDescription": noOption("docx.js has no table description option"),
  "w:tblPrChange": noOption("docx.js cannot write tracked table formatting"),
};

/** w:gridCol widths, or null (with a note) when the grid has a column docx.js cannot write. */
function readGrid(tblGrid: XmlElement | null, notes: Note[]): number[] | null {
  if (tblGrid === null) return null;
  const widths: number[] = [];
  let complete = true;
  for (const child of elementsOf(tblGrid)) {
    if (child.name !== "w:gridCol") {
      notes.push(dropped(child.name, "docx.js writes only w:gridCol widths in a table grid"));
      continue;
    }
    const width = requiredAttribute(child, "w:w", notes) === null ? null : twipsAt(child, "w:w", notes);
    if (width === null) complete = false;
    else widths.push(width);
  }
  if (complete) return widths;
  notes.push(dropped(tblGrid.name, "docx.js needs every grid column's width, so columnWidths is left out"));
  return null;
}

/** Takes the whole w:tbl, because columnWidths lives in w:tblGrid, beside w:tblPr. */
export function readTableProperties(tbl: XmlElement, env: CodecEnv): CodecResult<TableOptions> {
  const tblPr = childNamed(tbl, "w:tblPr");
  const { options, notes } = applyFates(tblPr, TBLPR_FATES, env);
  const overlapElement = childNamed(tblPr, "w:tblOverlap");
  const overlap = readOverlap(overlapElement, notes);
  if (overlap !== null && options.float === undefined) {
    notes.push(dropped("w:tblOverlap", "docx.js writes it only for a floating table, and this one has no w:tblpPr"));
  } else if (overlap !== null) {
    options.float = { ...options.float, overlap };
  }
  const columnWidths = readGrid(childNamed(tbl, "w:tblGrid"), notes);
  if (columnWidths !== null) options.columnWidths = columnWidths;
  return { options, notes };
}

const toRow = <K extends keyof RowOptions>(key: K, read: ValueReader<NonNullable<Draft<RowOptions>[K]>>) =>
  mapTo<RowOptions, K>(key, read);

const readHeight: ValueReader<NonNullable<RowOptions["height"]>> = (el, _env, notes) => {
  if (requiredAttribute(el, "w:val", notes) === null) return null;
  const value = twipsAt(el, "w:val", notes);
  if (value === null) return null;
  const rule = attrOf(el, "w:hRule") === null ? "atLeast" : oneOfAt(el, "w:hRule", HEIGHT_RULES, notes);
  return rule === null ? null : { value, rule };
};

export const TRPR_FATES: FateTable<RowOptions> = {
  "w:cnfStyle": { fate: "ignored" },
  "w:divId": noOption("docx.js has no divId option"),
  "w:gridBefore": noOption("docx.js has no gridBefore option"),
  "w:gridAfter": noOption("docx.js has no gridAfter option"),
  "w:wBefore": noOption("docx.js has no wBefore option"),
  "w:wAfter": noOption("docx.js has no wAfter option"),
  "w:cantSplit": toRow("cantSplit", onOff(true)),
  "w:trHeight": toRow("height", readHeight),
  "w:tblHeader": toRow("tableHeader", onOff(true)),
  "w:tblCellSpacing": toRow("cellSpacing", readCellSpacing),
  "w:jc": noOption("docx.js has no row alignment option"),
  "w:hidden": noOption("docx.js has no hidden row option"),
  "w:trPrChange": noOption("docx.js cannot write tracked row formatting"),
};

export function readRowProperties(trPr: XmlElement | null, env: CodecEnv): CodecResult<RowOptions> {
  return applyFates(trPr, TRPR_FATES, env);
}

const toCell = <K extends keyof CellOptions>(key: K, read: ValueReader<NonNullable<Draft<CellOptions>[K]>>) =>
  mapTo<CellOptions, K>(key, read);

/** A w:vMerge with no w:val continues the merge above it. */
const readVerticalMerge: ValueReader<NonNullable<CellOptions["verticalMerge"]>> = (el, _env, notes) =>
  attrOf(el, "w:val") === null ? "continue" : oneOfAt(el, "w:val", VERTICAL_MERGES, notes);

export const TCPR_FATES: FateTable<CellOptions> = {
  "w:cnfStyle": { fate: "ignored" },
  "w:tcW": toCell("width", readWidth),
  "w:gridSpan": toCell("columnSpan", wholeNumberVal),
  "w:hMerge": noOption("docx.js has no horizontal merge option; it writes w:gridSpan"),
  "w:vMerge": toCell("verticalMerge", readVerticalMerge),
  "w:tcBorders": toCell("borders", bordersOf(CELL_BORDER_FATES)),
  "w:shd": toCell("shading", readShading),
  "w:noWrap": noOption("docx.js has no noWrap option"),
  "w:tcMar": toCell("margins", readMargins),
  "w:textDirection": toCell("textDirection", oneOfVal(TEXT_DIRECTIONS)),
  "w:tcFitText": noOption("docx.js has no tcFitText option"),
  "w:vAlign": toCell("verticalAlign", oneOfVal(CELL_VERTICAL_ALIGNS)),
  "w:hideMark": noOption("docx.js has no hideMark option"),
  "w:tcPrChange": noOption("docx.js cannot write tracked cell formatting"),
};

export function readCellProperties(tcPr: XmlElement | null, env: CodecEnv): CodecResult<CellOptions> {
  return applyFates(tcPr, TCPR_FATES, env);
}
