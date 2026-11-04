/** w:lvl (one numbering level of a w:abstractNum) → docx.js ILevelsOptions.
 *
 *  - docx.js throws above level 9, writes w:isLgl only when it is on, and writes w:lvlText only when it is
 *    not empty. */

import type * as docx from "docx";
import { attrOf, type XmlElement } from "./xml";
import {
  applyFates,
  dropped,
  mapTo,
  oneOfVal,
  onOff,
  stringVal,
  wholeNumberAt,
  wholeNumberVal,
  ALIGNMENTS,
  NUMBER_FORMATS,
  noOption,
  type CodecEnv,
  type CodecResult,
  type Draft,
  type FateTable,
  type Note,
  type ValueOf,
  type ValueReader,
} from "./codec";
import { readRunProperties } from "./run";
import { dropNumbering, readStyleParagraph } from "./style";

type LevelOptions = Omit<docx.ILevelsOptions, "level">;

const MAX_LEVEL = 9;

const LEVEL_FORMATS: readonly ValueOf<typeof docx.LevelFormat>[] = [...NUMBER_FORMATS, "custom"];
const SUFFIXES: readonly ValueOf<typeof docx.LevelSuffix>[] = ["nothing", "space", "tab"];


const to = <K extends keyof LevelOptions>(key: K, read: ValueReader<NonNullable<Draft<LevelOptions>[K]>>) =>
  mapTo<LevelOptions, K>(key, read);

const readText: ValueReader<string> = (el, env, notes) => {
  const text = stringVal(el, env, notes);
  if (text !== "") return text;
  notes.push(dropped(el.name, "docx.js does not write an empty level text"));
  return null;
};

const LVL_FATES: FateTable<LevelOptions> = {
  "w:start": to("start", wholeNumberVal),
  "w:numFmt": to("format", oneOfVal(LEVEL_FORMATS)),
  "w:lvlRestart": noOption("docx.js has no lvlRestart option"),
  "w:pStyle": noOption("docx.js has no level paragraph style option"),
  "w:isLgl": to("isLegalNumberingStyle", onOff(false)),
  "w:suff": to("suffix", oneOfVal(SUFFIXES)),
  "w:lvlText": to("text", readText),
  "w:lvlPicBulletId": noOption("docx.js cannot write picture bullets"),
  "w:legacy": noOption("docx.js has no legacy numbering option"),
  "w:lvlJc": to("alignment", oneOfVal(ALIGNMENTS)),
  "w:pPr": {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const { paragraph, numPr } = readStyleParagraph(el, env, notes);
      dropNumbering(numPr, "a numbering level", notes);
      if (Object.keys(paragraph).length > 0) out.style = { ...out.style, paragraph };
    },
  },
  "w:rPr": {
    fate: "mapped",
    read: (el, out, env, notes) => {
      const run = readRunProperties(el, env);
      notes.push(...run.notes);
      if (Object.keys(run.options).length > 0) out.style = { ...out.style, run: run.options };
    },
  },
};

function levelNumber(lvl: XmlElement, notes: Note[]): number {
  const level = wholeNumberAt(lvl, "w:ilvl", notes);
  if (level !== null && level >= 0 && level <= MAX_LEVEL) return level;
  const detail = `w:ilvl="${attrOf(lvl, "w:ilvl") ?? ""}" is not a level docx.js writes (0 to ${MAX_LEVEL}), so it reads as 0`;
  notes.push(dropped(lvl.name, detail));
  return 0;
}

export function readLevel(lvl: XmlElement, env: CodecEnv): CodecResult<docx.ILevelsOptions> {
  const { options, notes } = applyFates(lvl, LVL_FATES, env);
  return { options: { level: levelNumber(lvl, notes), ...options }, notes };
}
