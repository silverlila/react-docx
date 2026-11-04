/** Expands Lists into list paragraphs with their numbering, and builds the list definitions that
 *  numbering uses.
 *
 *  docx.js restarts a numbering instance only at level 0. So a List nested under a List of the other
 *  type gets a definition of its own, whose level 0 sits at its depth ("NumberedList@2"). */

import type * as docx from "docx";
import { LEVEL_NUMBER } from "../ooxml/markers";
import { TreeError, isRecord, type AuthorNode, type IndexedChild } from "./author";

type NumberingConfig = docx.INumberingOptions["config"][number];
type Level = NumberingConfig["levels"][number];
type ListType = "NumberedList" | "BulletList";

const LEVEL_COUNT = 9;
const NUMBERED_FORMATS = ["decimal", "lowerLetter", "lowerRoman"] as const;
const BULLET_SYMBOLS = ["•", "◦", "▪"] as const;

function level(type: ListType, n: number): Level {
  const marker =
    type === "NumberedList"
      ? { format: NUMBERED_FORMATS[n % 3], text: `%${n + 1}.` }
      : { format: "bullet" as const, text: BULLET_SYMBOLS[n % 3] };
  return { level: n, ...marker, alignment: "left", style: { paragraph: { indent: { left: 720 * (n + 1), hanging: 360 } } } };
}

function defaultLevels(type: ListType): Level[] {
  return Array.from({ length: LEVEL_COUNT }, (_, n) => level(type, n));
}

/** Levels 0–8 for "NumberedList" and "BulletList". Level 0 of each is 0.1.8's DEFAULT_NUMBERING. */
export const LIST_NUMBERING: { readonly config: readonly NumberingConfig[] } = {
  config: [
    { reference: "NumberedList", levels: defaultLevels("NumberedList") },
    { reference: "BulletList", levels: defaultLevels("BulletList") },
  ],
};

export type ListLevels = ReadonlyMap<string, readonly Level[]>;

export function numberingConfig(numbering: unknown, path: readonly string[]): readonly NumberingConfig[] {
  if (numbering === undefined) return [];
  if (!isRecord(numbering)) {
    throw new TreeError(path, "numbering must be an object with a config array, docx.js's INumberingOptions");
  }
  if (!Array.isArray(numbering.config)) throw new TreeError(path, "numbering.config must be an array");
  const config: readonly unknown[] = numbering.config;
  config.forEach((entry, i) => {
    if (!isRecord(entry) || typeof entry.reference !== "string" || !Array.isArray(entry.levels)) {
      throw new TreeError(path, `numbering.config[${i}] must have a string reference and a levels array`);
    }
    const levels: readonly unknown[] = entry.levels;
    levels.forEach((level, j) => {
      if (!isRecord(level) || !Number.isInteger(level.level)) {
        throw new TreeError(path, `numbering.config[${i}].levels[${j}] must be an object with a whole-number level`);
      }
    });
  });
  return config as readonly NumberingConfig[];
}

export function listLevels(config: readonly NumberingConfig[]): ListLevels {
  return new Map(config.map((entry) => [entry.reference, entry.levels]));
}

type ListNumbering = { readonly reference: string; readonly level: number; readonly instance: number };

export type ListEntry = {
  readonly item: AuthorNode;
  readonly content: readonly IndexedChild[];
  readonly path: readonly string[];
  readonly numbering: ListNumbering;
  readonly definition: NumberingConfig;
};

type ListContext = { readonly nextInstance: () => number; readonly levels: ListLevels };

type Definition = { readonly config: NumberingConfig; readonly missing: (level: number) => string };

type Nesting = {
  readonly type: ListType;
  readonly depth: number;
  readonly definition: Definition;
  readonly numbering: ListNumbering;
};

function listType(list: AuthorNode): ListType {
  return list.props.type === "numbered" ? "NumberedList" : "BulletList";
}

function definitionAt(type: ListType, start: number, configured: ListLevels): Definition {
  const reference = start === 0 ? type : `${type}@${start}`;
  const own = configured.get(reference);
  if (own !== undefined) {
    return { config: { reference, levels: own }, missing: (level) => `numbering ${reference} defines no level ${level}` };
  }
  const base = configured.get(type) ?? defaultLevels(type);
  const unusable = new Map<number, string>();
  const moved: Level[] = [];
  for (const l of base.filter((candidate) => candidate.level >= start)) {
    const shown = [...(l.text ?? "").matchAll(LEVEL_NUMBER)].map(([, n]) => Number(n) - 1);
    const enclosing = shown.find((s) => s < start);
    if (enclosing !== undefined) {
      const marker = `numbering ${type} level ${l.level} marker "${l.text}"`;
      unusable.set(l.level - start, `${marker} shows the number of level ${enclosing}, which belongs to the enclosing list here`);
      continue;
    }
    const text = l.text === undefined ? {} : { text: l.text.replace(LEVEL_NUMBER, (_, n: string) => `%${Number(n) - start}`) };
    moved.push({ ...l, level: l.level - start, ...text });
  }
  return {
    config: { reference, levels: moved },
    missing: (level) => unusable.get(level) ?? `numbering ${type} defines no level ${start + level}`,
  };
}

function nestingOf(list: AuthorNode, parent: Nesting | undefined, context: ListContext): Nesting {
  const type = listType(list);
  const depth = parent === undefined ? 0 : parent.depth + 1;
  if (parent !== undefined && type === parent.type) {
    const { reference, level, instance } = parent.numbering;
    return { ...parent, depth, numbering: { reference, level: level + 1, instance } };
  }
  const definition = definitionAt(type, depth, context.levels);
  const numbering = { reference: definition.config.reference, level: 0, instance: context.nextInstance() };
  return { type, depth, definition, numbering };
}

export function listEntries(list: AuthorNode, path: readonly string[], context: ListContext, parent?: Nesting): ListEntry[] {
  if (list.props.level !== undefined) {
    throw new TreeError(path, "List.level was removed; nest <List> instead");
  }
  if (parent !== undefined && parent.depth + 1 >= LEVEL_COUNT) {
    throw new TreeError(path, `Lists nest at most ${LEVEL_COUNT} deep: Word numbers ${LEVEL_COUNT} levels`);
  }
  const first = list.children[0];
  if (typeof first === "object" && first.type === "List") {
    throw new TreeError([...path, "List[0]"], "A <List> must start with a <ListItem>, the item its numbering restarts at");
  }
  const nesting = nestingOf(list, parent, context);
  const entries: ListEntry[] = [];
  list.children.forEach((child, index) => {
    if (typeof child === "string") throw new TreeError(path, "Text is not allowed directly in <List>");
    const childPath = [...path, `${child.type}[${index}]`];
    if (child.type === "List") {
      entries.push(...listEntries(child, childPath, context, nesting));
    } else if (child.type === "ListItem") {
      entries.push(...itemEntries(child, childPath, context, nesting));
    } else {
      throw new TreeError(childPath, `<${child.type}> is not allowed in <List>`);
    }
  });
  return entries;
}

function itemEntries(item: AuthorNode, path: readonly string[], context: ListContext, nesting: Nesting): ListEntry[] {
  const { level } = nesting.numbering;
  if (!nesting.definition.config.levels.some((l) => l.level === level)) {
    throw new TreeError(path, `${nesting.definition.missing(level)}, which this list item needs`);
  }
  const content: IndexedChild[] = [];
  const nested: ListEntry[] = [];
  item.children.forEach((child, index) => {
    if (typeof child !== "string" && child.type === "List") {
      nested.push(...listEntries(child, [...path, `List[${index}]`], context, nesting));
    } else {
      content.push({ child, index });
    }
  });
  return [{ item, content, path, numbering: nesting.numbering, definition: nesting.definition.config }, ...nested];
}
