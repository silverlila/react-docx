/** w:sectPr → docx.js section properties, plus the header and footer references beside them.
 *
 *  - The writer-inverse test defines correctness.
 *  - docx.js's page size is the portrait one: for a landscape page it writes w:w from height and w:h from
 *    width. So a landscape w:pgSz reads w:w into height and w:h into width.
 *  - docx.js's column.children must be docx.js Column instances, which a plain tree cannot hold, so each
 *    w:col is dropped. docx.js writes no w:col when equalWidth is on, so equal columns lose nothing.
 *  - w:headerReference and w:footerReference are not options: the body walk (unit 04) reads their parts. */

import type * as docx from "docx";
import { attrOf, elementsOf, type XmlElement } from "../read/xml";
import { PRESENCE_ONLY } from "../schema/docx-facts";
import {
  applyFates,
  dropped,
  isOnValue,
  mapTo,
  oneOfAt,
  oneOfVal,
  onOff,
  readBorder,
  wholeNumberAt,
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
import { twipsAt } from "./table";

type SectionProperties = docx.ISectionPropertiesOptions;
type Page = NonNullable<SectionProperties["page"]>;
type HeaderFooterReference = SectionRead["references"][number];

export type SectionRead = CodecResult<{ properties?: docx.ISectionPropertiesOptions }> & {
  readonly references: readonly {
    readonly kind: "header" | "footer";
    readonly type: "default" | "first" | "even";
    readonly relId: string;
  }[];
};


const ORIENTATIONS: readonly ValueOf<typeof docx.PageOrientation>[] = ["portrait", "landscape"];
const PAGE_NUMBER_SEPARATORS: readonly ValueOf<typeof docx.PageNumberSeparator>[] = [
  "hyphen",
  "period",
  "colon",
  "emDash",
  "endash",
];
const BORDER_DISPLAYS: readonly ValueOf<typeof docx.PageBorderDisplay>[] = ["allPages", "firstPage", "notFirstPage"];
const BORDER_OFFSETS: readonly ValueOf<typeof docx.PageBorderOffsetFrom>[] = ["page", "text"];
const BORDER_Z_ORDERS: readonly ValueOf<typeof docx.PageBorderZOrder>[] = ["back", "front"];
const TEXT_DIRECTIONS: readonly ValueOf<typeof docx.PageTextDirectionType>[] = ["lrTb", "tbRl"];
const GRID_TYPES: readonly ValueOf<typeof docx.DocumentGridType>[] = [
  "default",
  "lines",
  "linesAndChars",
  "snapToChars",
];
const LINE_NUMBER_RESTARTS: readonly ValueOf<typeof docx.LineNumberRestartFormat>[] = [
  "newPage",
  "newSection",
  "continuous",
];
const VERTICAL_ALIGNS: readonly docx.SectionVerticalAlign[] = ["top", "center", "bottom", "both"];
const SECTION_TYPES: readonly ValueOf<typeof docx.SectionType>[] = [
  "nextPage",
  "nextColumn",
  "continuous",
  "evenPage",
  "oddPage",
];
const REFERENCE_TYPES: readonly HeaderFooterReference["type"][] = ["default", "first", "even"];

/** w:pgNumType's w:fmt: docx.js's NumberFormat. */
export const NUMBER_FORMATS: readonly ValueOf<typeof docx.NumberFormat>[] = [
  "decimal",
  "upperRoman",
  "lowerRoman",
  "upperLetter",
  "lowerLetter",
  "ordinal",
  "cardinalText",
  "ordinalText",
  "hex",
  "chicago",
  "ideographDigital",
  "japaneseCounting",
  "aiueo",
  "iroha",
  "decimalFullWidth",
  "decimalHalfWidth",
  "japaneseLegal",
  "japaneseDigitalTenThousand",
  "decimalEnclosedCircle",
  "decimalFullWidth2",
  "aiueoFullWidth",
  "irohaFullWidth",
  "decimalZero",
  "bullet",
  "ganada",
  "chosung",
  "decimalEnclosedFullstop",
  "decimalEnclosedParen",
  "decimalEnclosedCircleChinese",
  "ideographEnclosedCircle",
  "ideographTraditional",
  "ideographZodiac",
  "ideographZodiacTraditional",
  "taiwaneseCounting",
  "ideographLegalTraditional",
  "taiwaneseCountingThousand",
  "taiwaneseDigital",
  "chineseCounting",
  "chineseLegalSimplified",
  "chineseCountingThousand",
  "koreanDigital",
  "koreanCounting",
  "koreanLegal",
  "koreanDigital2",
  "vietnameseCounting",
  "russianLower",
  "russianUpper",
  "none",
  "numberInDash",
  "hebrew1",
  "hebrew2",
  "arabicAlpha",
  "arabicAbjad",
  "hindiVowels",
  "hindiConsonants",
  "hindiNumbers",
  "hindiCounting",
  "thaiLetters",
  "thaiNumbers",
  "thaiCounting",
  "bahtText",
  "dollarText",
];


const isEmpty = (options: object): boolean => Object.keys(options).length === 0;

/** A fate that sets `page[key]` to what `read` returns, unless it returns null. */
function pageTo<K extends keyof Page>(key: K, read: ValueReader<NonNullable<Page[K]>>): Fate<SectionProperties> {
  return {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const value = read(el, env, notes);
      if (value !== null) out.page = { ...out.page, [key]: value };
    },
  };
}

const to = <K extends keyof SectionProperties>(key: K, read: ValueReader<NonNullable<Draft<SectionProperties>[K]>>) =>
  mapTo<SectionProperties, K>(key, read);

const readSize: ValueReader<NonNullable<Page["size"]>> = (el, _env, notes) => {
  const size: Draft<docx.IPageSizeAttributes> = {};
  const orientation = oneOfAt(el, "w:orient", ORIENTATIONS, notes);
  const landscape = orientation === "landscape";
  const width = twipsAt(el, landscape ? "w:h" : "w:w", notes);
  if (width !== null) size.width = width;
  const height = twipsAt(el, landscape ? "w:w" : "w:h", notes);
  if (height !== null) size.height = height;
  if (orientation !== null) size.orientation = orientation;
  return size;
};

const readMargin: ValueReader<docx.IPageMarginAttributes> = (el, _env, notes) => {
  const margin: Draft<docx.IPageMarginAttributes> = {};
  const top = wholeNumberAt(el, "w:top", notes);
  if (top !== null) margin.top = top;
  const right = twipsAt(el, "w:right", notes);
  if (right !== null) margin.right = right;
  const bottom = wholeNumberAt(el, "w:bottom", notes);
  if (bottom !== null) margin.bottom = bottom;
  const left = twipsAt(el, "w:left", notes);
  if (left !== null) margin.left = left;
  const header = twipsAt(el, "w:header", notes);
  if (header !== null) margin.header = header;
  const footer = twipsAt(el, "w:footer", notes);
  if (footer !== null) margin.footer = footer;
  const gutter = twipsAt(el, "w:gutter", notes);
  if (gutter !== null) margin.gutter = gutter;
  return margin;
};

/** docx.js writes an empty w:pgNumType when there is nothing to say, so an empty one reads as nothing. */
const readPageNumbers: ValueReader<docx.IPageNumberTypeAttributes> = (el, _env, notes) => {
  const pageNumbers: Draft<docx.IPageNumberTypeAttributes> = {};
  const start = wholeNumberAt(el, "w:start", notes);
  if (start !== null) pageNumbers.start = start;
  const formatType = oneOfAt(el, "w:fmt", NUMBER_FORMATS, notes);
  if (formatType !== null) pageNumbers.formatType = formatType;
  const separator = oneOfAt(el, "w:chapSep", PAGE_NUMBER_SEPARATORS, notes);
  if (separator !== null) pageNumbers.separator = separator;
  return isEmpty(pageNumbers) ? null : pageNumbers;
};

const pageSide = (key: "pageBorderTop" | "pageBorderRight" | "pageBorderBottom" | "pageBorderLeft") =>
  mapTo<docx.IPageBordersOptions, typeof key>(key, readBorder);

const PAGE_BORDER_FATES: FateTable<docx.IPageBordersOptions> = {
  "w:top": pageSide("pageBorderTop"),
  "w:left": pageSide("pageBorderLeft"),
  "w:bottom": pageSide("pageBorderBottom"),
  "w:right": pageSide("pageBorderRight"),
};

const readPageBorders: ValueReader<docx.IPageBordersOptions> = (el, env, notes) => {
  const read = applyFates(el, PAGE_BORDER_FATES, env);
  notes.push(...read.notes);
  const pageBorders: Draft<docx.IPageBorderAttributes> = {};
  const display = oneOfAt(el, "w:display", BORDER_DISPLAYS, notes);
  if (display !== null) pageBorders.display = display;
  const offsetFrom = oneOfAt(el, "w:offsetFrom", BORDER_OFFSETS, notes);
  if (offsetFrom !== null) pageBorders.offsetFrom = offsetFrom;
  const zOrder = oneOfAt(el, "w:zOrder", BORDER_Z_ORDERS, notes);
  if (zOrder !== null) pageBorders.zOrder = zOrder;
  const borders = isEmpty(pageBorders) ? read.options : { pageBorders, ...read.options };
  return isEmpty(borders) ? null : borders;
};

/** docx.js writes w:charSpace only when it is not zero, and w:linePitch always (360 when unset). */
const readGrid: ValueReader<NonNullable<SectionProperties["grid"]>> = (el, _env, notes) => {
  const grid: Draft<docx.IDocGridAttributesProperties> = {};
  const type = oneOfAt(el, "w:type", GRID_TYPES, notes);
  if (type !== null) grid.type = type;
  const linePitch = wholeNumberAt(el, "w:linePitch", notes);
  if (linePitch !== null) grid.linePitch = linePitch;
  const charSpace = wholeNumberAt(el, "w:charSpace", notes);
  if (charSpace !== null && charSpace !== 0) grid.charSpace = charSpace;
  return grid;
};

const readLineNumbers: ValueReader<docx.ILineNumberAttributes> = (el, _env, notes) => {
  const lineNumbers: Draft<docx.ILineNumberAttributes> = {};
  const countBy = wholeNumberAt(el, "w:countBy", notes);
  if (countBy !== null) lineNumbers.countBy = countBy;
  const start = wholeNumberAt(el, "w:start", notes);
  if (start !== null) lineNumbers.start = start;
  const restart = oneOfAt(el, "w:restart", LINE_NUMBER_RESTARTS, notes);
  if (restart !== null) lineNumbers.restart = restart;
  const distance = twipsAt(el, "w:distance", notes);
  if (distance !== null) lineNumbers.distance = distance;
  return lineNumbers;
};

const readColumns: ValueReader<docx.IColumnsAttributes> = (el, _env, notes) => {
  const column: Draft<docx.IColumnsAttributes> = {};
  const space = twipsAt(el, "w:space", notes);
  if (space !== null) column.space = space;
  const count = wholeNumberAt(el, "w:num", notes);
  if (count !== null) column.count = count;
  const separate = attrOf(el, "w:sep");
  if (separate !== null) column.separate = isOnValue(separate);
  const equalWidth = attrOf(el, "w:equalWidth");
  if (equalWidth !== null) column.equalWidth = isOnValue(equalWidth);
  for (const child of elementsOf(el)) {
    notes.push(dropped(child.name, "docx.js needs Column instances for column widths, which a tree cannot hold"));
  }
  return column;
};

const titlePageIsWritableOff = !(PRESENCE_ONLY.Section ?? []).includes("properties.titlePage");

/** Read beside the options, into SectionRead.references. */
const RETURNED_BESIDE: Fate<SectionProperties> = { fate: "mapped", read: () => undefined };

export const SECTPR_FATES: FateTable<SectionProperties> = {
  "w:headerReference": RETURNED_BESIDE,
  "w:footerReference": RETURNED_BESIDE,
  "w:footnotePr": noOption("docx.js has no section footnote properties option"),
  "w:endnotePr": noOption("docx.js cannot write endnotes"),
  "w:type": to("type", oneOfVal(SECTION_TYPES)),
  "w:pgSz": pageTo("size", readSize),
  "w:pgMar": pageTo("margin", readMargin),
  "w:paperSrc": noOption("docx.js has no paper source option"),
  "w:pgBorders": pageTo("borders", readPageBorders),
  "w:lnNumType": to("lineNumbers", readLineNumbers),
  "w:pgNumType": pageTo("pageNumbers", readPageNumbers),
  "w:cols": to("column", readColumns),
  "w:formProt": noOption("docx.js has no form protection option"),
  "w:vAlign": to("verticalAlign", oneOfVal(VERTICAL_ALIGNS)),
  "w:noEndnote": noOption("docx.js cannot write endnotes"),
  "w:titlePg": to("titlePage", onOff(titlePageIsWritableOff)),
  "w:textDirection": pageTo("textDirection", oneOfVal(TEXT_DIRECTIONS)),
  "w:bidi": noOption("docx.js has no right-to-left section option"),
  "w:rtlGutter": noOption("docx.js has no rtlGutter option"),
  "w:docGrid": to("grid", readGrid),
  "w:printerSettings": noOption("it points at a printer settings part, which docx.js cannot write"),
  "w:sectPrChange": noOption("docx.js cannot write tracked section formatting"),
};

function readReference(el: XmlElement, notes: Note[]): HeaderFooterReference | null {
  const kind = el.name === "w:headerReference" ? "header" : "footer";
  const type = attrOf(el, "w:type") === null ? "default" : oneOfAt(el, "w:type", REFERENCE_TYPES, notes);
  const relId = attrOf(el, "r:id");
  if (relId === null) notes.push(dropped(el.name, "it has no r:id"));
  return type === null || relId === null ? null : { kind, type, relId };
}

export function readSectionProperties(sectPr: XmlElement | null, env: CodecEnv): SectionRead {
  const { options, notes } = applyFates(sectPr, SECTPR_FATES, env);
  const references: HeaderFooterReference[] = [];
  for (const child of elementsOf(sectPr)) {
    if (child.name !== "w:headerReference" && child.name !== "w:footerReference") continue;
    const reference = readReference(child, notes);
    if (reference !== null) references.push(reference);
  }
  return { options: isEmpty(options) ? {} : { properties: options }, notes, references };
}
