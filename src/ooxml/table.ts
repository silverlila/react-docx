/** w:tblPr (with the sibling w:tblGrid), w:trPr and w:tcPr → docx.js table, row and cell options.
 *
 *  - docx.js's `rowSpan` invents continuation cells.
 *  - docx.js writes a pct width as whole percent, where Word writes fiftieths of a percent. An absent w:type
 *    is the schema's "dxa"; docx.js's default is "auto".
 *  - docx.js writes w:tblOverlap inside w:tblpPr, where Word writes it beside it in w:tblPr.
 *  - docx.js writes w:tblBorders on every table, with a single border for each side not given, so a side
 *    left to the table style loses that style's border. No option avoids it.
 *  - docx.js's cell margins share one unit, and each is a number, read as percent when the unit is pct. */

import type * as docx from "docx";
import { attrOf, childNamed, elementsOf, type XmlElement } from "./xml";
import {
  isOnValue,
  applyFates,
  dropped,
  mapTo,
  oneOfAt,
  oneOfVal,
  onOff,
  readBorder,
  readShading,
  requiredAttr,
  stringVal,
  twipsAt,
  wholeNumberAt,
  wholeNumberVal,
  HANDLED_BESIDE,
  HEIGHT_RULES,
  INTEGER,
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

const PERCENT = /^-?[0-9]+(\.[0-9]+)?%$/;
const FIFTIETHS_PER_PERCENT = 50;


function measureAt(el: XmlElement, type: WidthType, notes: Note[]): Measure | null {
  const value = requiredAttr(el, "w:w", notes);
  if (value === null) return null;
  if (PERCENT.test(value)) return `${Number(value.slice(0, -1))}%`;
  if (INTEGER.test(value)) return type === "pct" ? `${Number(value) / FIFTIETHS_PER_PERCENT}%` : Number(value);
  if (isUniversalMeasure(value)) return value;
  notes.push(dropped(el.name, `w:w="${value}" is not a measure docx.js writes`));
  return null;
}

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

const TBLPR_FATES: FateTable<TableOptions> = {
  "w:tblStyle": to("style", stringVal),
  "w:tblpPr": to("float", readFloat),
  "w:tblOverlap": HANDLED_BESIDE,
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

function readGrid(tblGrid: XmlElement | null, notes: Note[]): number[] | null {
  if (tblGrid === null) return null;
  const widths: number[] = [];
  let complete = true;
  for (const child of elementsOf(tblGrid)) {
    if (child.name !== "w:gridCol") {
      notes.push(dropped(child.name, "docx.js writes only w:gridCol widths in a table grid"));
      continue;
    }
    const width = requiredAttr(child, "w:w", notes) === null ? null : twipsAt(child, "w:w", notes);
    if (width === null) complete = false;
    else widths.push(width);
  }
  if (complete) return widths;
  notes.push(dropped(tblGrid.name, "docx.js needs every grid column's width, so columnWidths is left out"));
  return null;
}

const TABLE_SIDES = ["top", "left", "bottom", "right", "insideHorizontal", "insideVertical"] as const;
const NO_BORDER: docx.IBorderOptions = { style: "none", size: 0, color: "auto" };

/** Each table style's borders with its basedOn chain's beneath them, by style id; the default table style's
 *  (w:default="1") also under "". */
export function tableStyleBorders(styles: XmlElement | null, env: CodecEnv): ReadonlyMap<string, docx.ITableBordersOptions> {
  const own = new Map<string, { basedOn: string | null; borders: docx.ITableBordersOptions }>();
  let defaultId: string | null = null;
  for (const style of elementsOf(styles)) {
    const id = attrOf(style, "w:styleId");
    if (style.name !== "w:style" || attrOf(style, "w:type") !== "table" || id === null) continue;
    const tblBorders = childNamed(childNamed(style, "w:tblPr"), "w:tblBorders");
    const borders = tblBorders === null ? {} : applyFates(tblBorders, TABLE_BORDER_FATES, env).options;
    own.set(id, { basedOn: attrOf(childNamed(style, "w:basedOn"), "w:val"), borders });
    const isDefault = attrOf(style, "w:default");
    if (isDefault !== null && isOnValue(isDefault)) defaultId = id;
  }
  const merged = new Map<string, docx.ITableBordersOptions>();
  const resolve = (id: string, depth: number): docx.ITableBordersOptions => {
    const style = own.get(id);
    if (style === undefined || depth > 10) return {};
    const base = style.basedOn === null ? {} : resolve(style.basedOn, depth + 1);
    return { ...base, ...style.borders };
  };
  for (const id of own.keys()) merged.set(id, resolve(id, 0));
  if (defaultId !== null) merged.set("", merged.get(defaultId) ?? {});
  return merged;
}

/** The sides a table does not give are its style's, or none: what Word draws, which docx.js would
 *  otherwise write as single lines. */
function withStyleBorders(options: Draft<TableOptions>, env: CodecEnv, notes: Note[]): void {
  if (env.tableStyleBorders === undefined) return;
  const own = options.borders ?? {};
  if (TABLE_SIDES.every((side) => own[side] !== undefined)) return;
  const style = env.tableStyleBorders.get(options.style ?? "") ?? {};
  const borders: Draft<docx.ITableBordersOptions> = {};
  for (const side of TABLE_SIDES) borders[side] = own[side] ?? style[side] ?? NO_BORDER;
  options.borders = borders;
  notes.push({ fate: "resolved", element: "w:tblBorders", detail: "sides the table does not give are its table style's, or none" });
}

export function readTableProperties(tbl: XmlElement, env: CodecEnv): CodecResult<TableOptions> {
  const tblPr = childNamed(tbl, "w:tblPr");
  const { options, notes } = applyFates(tblPr, TBLPR_FATES, env);
  withStyleBorders(options, env, notes);
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
  if (requiredAttr(el, "w:val", notes) === null) return null;
  const value = twipsAt(el, "w:val", notes);
  if (value === null) return null;
  const rule = attrOf(el, "w:hRule") === null ? "atLeast" : oneOfAt(el, "w:hRule", HEIGHT_RULES, notes);
  return rule === null ? null : { value, rule };
};

const TRPR_FATES: FateTable<RowOptions> = {
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

const readVerticalMerge: ValueReader<NonNullable<CellOptions["verticalMerge"]>> = (el, _env, notes) =>
  attrOf(el, "w:val") === null ? "continue" : oneOfAt(el, "w:val", VERTICAL_MERGES, notes);

const TCPR_FATES: FateTable<CellOptions> = {
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
