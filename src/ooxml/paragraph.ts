/** w:pPr → docx.js paragraph options, plus the two children that are not options: w:numPr (for lists,
 *  unit 05) and w:sectPr (for the section split, unit 04).
 *
 *  - The writer-inverse test defines correctness, as for runs.
 *  - Off values docx.js cannot write: pageBreakBefore and overflowPunctuation, which it writes only
 *    when on. These are dropped.
 *  - docx.js's wordWrap: true writes <w:wordWrap w:val="0"/> and false writes nothing, so an off
 *    w:wordWrap reads as wordWrap: true and an on one is dropped.
 *  - autoSpaceEastAsianText writes only w:autoSpaceDN, so that is what it reads; w:autoSpaceDE is dropped.
 *  - w:spacing keeps the file's attribute order, which docx.js writes back.
 *  - w:ind folds w:start into left and w:end into right when left and right are absent.
 *  - docx.js's paragraph borders have no `between` or `bar` side, so those are dropped. */

import type * as docx from "docx";
import { attrOf, childNamed, childrenNamed, isOn, type XmlElement } from "./xml";
import {
  applyFates,
  dropped,
  isOnValue,
  mapTo,
  oneOfAt,
  oneOfVal,
  onOff,
  readBorder,
  readShading,
  stringVal,
  wholeNumberAt,
  wholeNumberVal,
  ALIGNMENTS,
  HANDLED_BESIDE,
  HEIGHT_RULES,
  noOption,
  type CodecEnv,
  type CodecResult,
  type Draft,
  type FateTable,
  type Note,
  type ValueOf,
  type ValueReader,
} from "./codec";
import { readRunOption } from "./run";

export type ParagraphOptions = Omit<docx.IParagraphOptions, "children" | "text" | "heading" | "numbering" | "bullet">;

export type ParagraphRead = CodecResult<ParagraphOptions> & {
  readonly numPr: { readonly numId: string; readonly level: number } | null;
  readonly sectPr: XmlElement | null;
};

type ParagraphFlag =
  | "keepNext"
  | "keepLines"
  | "pageBreakBefore"
  | "widowControl"
  | "suppressLineNumbers"
  | "contextualSpacing"
  | "bidirectional"
  | "overflowPunctuation"
  | "autoSpaceEastAsianText";
type FrameBase = Omit<docx.IXYFrameOptions, "type" | "position">;

const WRITTEN_ONLY_WHEN_ON: readonly ParagraphFlag[] = ["pageBreakBefore", "overflowPunctuation"];


const TAB_STOP_TYPES: readonly ValueOf<typeof docx.TabStopType>[] = [
  "left",
  "right",
  "center",
  "bar",
  "clear",
  "decimal",
  "end",
  "num",
  "start",
];

const LEADERS: readonly ValueOf<typeof docx.LeaderType>[] = ["dot", "hyphen", "middleDot", "none", "underscore"];

const LINE_RULES: readonly ValueOf<typeof docx.LineRuleType>[] = ["atLeast", "exactly", "exact", "auto"];

const FRAME_ANCHORS: readonly ValueOf<typeof docx.FrameAnchorType>[] = ["margin", "page", "text"];
const FRAME_WRAPS: readonly ValueOf<typeof docx.FrameWrap>[] = ["around", "auto", "none", "notBeside", "through", "tight"];
const DROP_CAPS: readonly ValueOf<typeof docx.DropCapType>[] = ["none", "drop", "margin"];
const HORIZONTAL_ALIGNS: readonly ValueOf<typeof docx.HorizontalPositionAlign>[] = [
  "center",
  "inside",
  "left",
  "outside",
  "right",
];
const VERTICAL_ALIGNS: readonly ValueOf<typeof docx.VerticalPositionAlign>[] = [
  "bottom",
  "center",
  "inside",
  "outside",
  "top",
];

const to = <K extends keyof ParagraphOptions>(key: K, read: ValueReader<NonNullable<Draft<ParagraphOptions>[K]>>) =>
  mapTo<ParagraphOptions, K>(key, read);

const offIsWritable = (key: ParagraphFlag): boolean => !WRITTEN_ONLY_WHEN_ON.includes(key);

const flag = (key: ParagraphFlag) => to(key, onOff(offIsWritable(key)));


const side = (key: keyof docx.IBordersOptions) => mapTo<docx.IBordersOptions, typeof key>(key, readBorder);

const PBDR_FATES: FateTable<docx.IBordersOptions> = {
  "w:top": side("top"),
  "w:left": side("left"),
  "w:bottom": side("bottom"),
  "w:right": side("right"),
  "w:between": noOption("docx.js paragraph borders have no between side"),
  "w:bar": noOption("docx.js paragraph borders have no bar side"),
};

/** w:pBdr's top, bottom, left and right sides, or undefined when none is read. */
function readBorders(el: XmlElement | null, env: CodecEnv, notes: Note[]): docx.IBordersOptions | undefined {
  const read = applyFates(el, PBDR_FATES, env);
  notes.push(...read.notes);
  return Object.keys(read.options).length === 0 ? undefined : read.options;
}

const readWordWrap: ValueReader<boolean> = (el, _env, notes) => {
  if (!isOn(el)) return true;
  notes.push(dropped(el.name, "docx.js writes w:wordWrap only off, as wordWrap: true"));
  return null;
};

const readSpacing: ValueReader<docx.ISpacingProperties> = (el, _env, notes) => {
  const spacing: Draft<docx.ISpacingProperties> = {};
  for (const [attribute, value] of Object.entries(el.attributes)) {
    switch (attribute) {
      case "w:before": {
        const before = wholeNumberAt(el, attribute, notes);
        if (before !== null) spacing.before = before;
        break;
      }
      case "w:after": {
        const after = wholeNumberAt(el, attribute, notes);
        if (after !== null) spacing.after = after;
        break;
      }
      case "w:line": {
        const line = wholeNumberAt(el, attribute, notes);
        if (line !== null) spacing.line = line;
        break;
      }
      case "w:lineRule": {
        const lineRule = oneOfAt(el, attribute, LINE_RULES, notes);
        if (lineRule !== null) spacing.lineRule = lineRule;
        break;
      }
      case "w:beforeAutospacing":
        spacing.beforeAutoSpacing = isOnValue(value);
        break;
      case "w:afterAutospacing":
        spacing.afterAutoSpacing = isOnValue(value);
        break;
    }
  }
  return spacing;
};

const readIndent: ValueReader<docx.IIndentAttributesProperties> = (el, _env, notes) => {
  const indent: Draft<docx.IIndentAttributesProperties> = {};
  const left = wholeNumberAt(el, "w:left", notes) ?? wholeNumberAt(el, "w:start", notes);
  if (left !== null) indent.left = left;
  const right = wholeNumberAt(el, "w:right", notes) ?? wholeNumberAt(el, "w:end", notes);
  if (right !== null) indent.right = right;
  const firstLine = wholeNumberAt(el, "w:firstLine", notes);
  if (firstLine !== null) indent.firstLine = firstLine;
  const hanging = wholeNumberAt(el, "w:hanging", notes);
  if (hanging !== null) indent.hanging = hanging;
  return indent;
};

const readTabs: ValueReader<readonly docx.TabStopDefinition[]> = (el, _env, notes) => {
  const stops: docx.TabStopDefinition[] = [];
  for (const tab of childrenNamed(el, "w:tab")) {
    const type = oneOfAt(tab, "w:val", TAB_STOP_TYPES, notes);
    const position = wholeNumberAt(tab, "w:pos", notes);
    if (type === null || position === null) {
      notes.push(dropped(tab.name, "docx.js needs a tab stop's w:val and w:pos"));
      continue;
    }
    const leader = oneOfAt(tab, "w:leader", LEADERS, notes);
    stops.push(leader === null ? { type, position } : { type, position, leader });
  }
  return stops;
};

const readFrame: ValueReader<docx.IFrameOptions> = (el, _env, notes) => {
  const width = wholeNumberAt(el, "w:w", notes);
  const height = wholeNumberAt(el, "w:h", notes);
  const horizontal = oneOfAt(el, "w:hAnchor", FRAME_ANCHORS, notes);
  const vertical = oneOfAt(el, "w:vAnchor", FRAME_ANCHORS, notes);
  if (width === null || height === null || horizontal === null || vertical === null) {
    notes.push(dropped(el.name, "docx.js needs w:w, w:h, w:hAnchor and w:vAnchor"));
    return null;
  }

  const base: Draft<FrameBase> & Pick<FrameBase, "width" | "height" | "anchor"> = {
    width,
    height,
    anchor: { horizontal, vertical },
  };
  const anchorLock = attrOf(el, "w:anchorLock");
  if (anchorLock !== null) base.anchorLock = isOnValue(anchorLock);
  const dropCap = oneOfAt(el, "w:dropCap", DROP_CAPS, notes);
  if (dropCap !== null) base.dropCap = dropCap;
  const wrap = oneOfAt(el, "w:wrap", FRAME_WRAPS, notes);
  if (wrap !== null) base.wrap = wrap;
  const lines = wholeNumberAt(el, "w:lines", notes);
  if (lines !== null) base.lines = lines;
  const rule = oneOfAt(el, "w:hRule", HEIGHT_RULES, notes);
  if (rule !== null) base.rule = rule;
  const spaceHorizontal = wholeNumberAt(el, "w:hSpace", notes);
  const spaceVertical = wholeNumberAt(el, "w:vSpace", notes);
  if (spaceHorizontal !== null && spaceVertical !== null) {
    base.space = { horizontal: spaceHorizontal, vertical: spaceVertical };
  } else if (spaceHorizontal !== null || spaceVertical !== null) {
    notes.push(dropped(el.name, "docx.js writes w:hSpace and w:vSpace only together"));
  }

  const x = wholeNumberAt(el, "w:x", notes);
  const y = wholeNumberAt(el, "w:y", notes);
  const xAlign = oneOfAt(el, "w:xAlign", HORIZONTAL_ALIGNS, notes);
  const yAlign = oneOfAt(el, "w:yAlign", VERTICAL_ALIGNS, notes);
  if (x !== null && y !== null && xAlign === null && yAlign === null) {
    return { ...base, type: "absolute", position: { x, y } };
  }
  if (xAlign !== null && yAlign !== null && x === null && y === null) {
    return { ...base, type: "alignment", alignment: { x: xAlign, y: yAlign } };
  }
  notes.push(dropped(el.name, "docx.js needs either w:x and w:y or w:xAlign and w:yAlign"));
  return null;
};

const PPR_FATES: FateTable<ParagraphOptions> = {
  "w:pStyle": to("style", stringVal),
  "w:keepNext": flag("keepNext"),
  "w:keepLines": flag("keepLines"),
  "w:pageBreakBefore": flag("pageBreakBefore"),
  "w:framePr": to("frame", readFrame),
  "w:widowControl": flag("widowControl"),
  "w:numPr": HANDLED_BESIDE,
  "w:suppressLineNumbers": flag("suppressLineNumbers"),
  "w:pBdr": to("border", (el, env, notes) => readBorders(el, env, notes) ?? null),
  "w:shd": to("shading", readShading),
  "w:tabs": to("tabStops", readTabs),
  "w:suppressAutoHyphens": noOption("docx.js has no suppressAutoHyphens paragraph option"),
  "w:kinsoku": noOption("docx.js has no kinsoku option"),
  "w:wordWrap": to("wordWrap", readWordWrap),
  "w:overflowPunct": flag("overflowPunctuation"),
  "w:topLinePunct": noOption("docx.js has no topLinePunct option"),
  "w:autoSpaceDE": noOption("docx.js writes only w:autoSpaceDN"),
  "w:autoSpaceDN": flag("autoSpaceEastAsianText"),
  "w:bidi": flag("bidirectional"),
  "w:adjustRightInd": noOption("docx.js has no adjustRightInd option"),
  "w:snapToGrid": noOption("docx.js has no paragraph snapToGrid option"),
  "w:spacing": to("spacing", readSpacing),
  "w:ind": to("indent", readIndent),
  "w:contextualSpacing": flag("contextualSpacing"),
  "w:mirrorIndents": noOption("docx.js has no mirrorIndents option"),
  "w:jc": to("alignment", oneOfVal(ALIGNMENTS)),
  "w:textDirection": noOption("docx.js has no paragraph textDirection option"),
  "w:textAlignment": noOption("docx.js has no textAlignment option"),
  "w:outlineLvl": to("outlineLevel", wholeNumberVal),
  "w:divId": noOption("docx.js has no divId option"),
  "w:cnfStyle": { fate: "ignored" },
  "w:rPr": to("run", readRunOption),
  "w:sectPr": HANDLED_BESIDE,
  "w:pPrChange": noOption("docx.js cannot write tracked paragraph formatting"),
};

function readNumPr(numPr: XmlElement | null, notes: Note[]): ParagraphRead["numPr"] {
  if (numPr === null) return null;
  const numId = attrOf(childNamed(numPr, "w:numId"), "w:val");
  if (numId === null) {
    notes.push(dropped(numPr.name, "it has no w:numId"));
    return null;
  }
  const ilvl = childNamed(numPr, "w:ilvl");
  return { numId, level: (ilvl === null ? null : wholeNumberAt(ilvl, "w:val", notes)) ?? 0 };
}

export function readParagraphProperties(pPr: XmlElement | null, env: CodecEnv): ParagraphRead {
  const { options, notes } = applyFates(pPr, PPR_FATES, env);
  const numPr = readNumPr(childNamed(pPr, "w:numPr"), notes);
  return { options, notes, numPr, sectPr: childNamed(pPr, "w:sectPr") };
}
