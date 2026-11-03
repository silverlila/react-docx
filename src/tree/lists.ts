import type * as docx from "docx";
import { TreeError, isRecord, type AuthorNode, type IndexedChild } from "./author";

type NumberingConfig = docx.INumberingOptions["config"][number];
type Level = NumberingConfig["levels"][number];
type ListType = "NumberedList" | "BulletList";

const LEVEL_COUNT = 9;
const NUMBERED_FORMATS = ["decimal", "lowerLetter", "lowerRoman"] as const;
const BULLET_SYMBOLS = ["•", "◦", "▪"] as const;
/** A level marker's `%1`–`%9`: the number of that level, counted from 1. */
const LEVEL_NUMBER = /%([1-9])/g;

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

/** The levels of each list definition the document's `numbering` configures, by reference. */
export type ListLevels = ReadonlyMap<string, readonly Level[]>;

/** Props are trusted as authored: a configured `levels` is docx.js's type. */
export function listLevels(numbering: unknown): ListLevels {
  const config: readonly unknown[] = isRecord(numbering) && Array.isArray(numbering.config) ? numbering.config : [];
  const levels = new Map<string, readonly Level[]>();
  for (const entry of config) {
    if (isRecord(entry) && typeof entry.reference === "string" && Array.isArray(entry.levels)) {
      levels.set(entry.reference, entry.levels as readonly Level[]);
    }
  }
  return levels;
}

/** A list paragraph's numbering: which list definition, how deep in it, and which instance of it. */
type ListNumbering = { readonly reference: string; readonly level: number; readonly instance: number };

/** One paragraph a List expands into: the item, its own content (nested Lists excluded), its numbering,
 *  and the definition that numbering names. */
export type ListEntry = {
  readonly item: AuthorNode;
  readonly content: readonly IndexedChild[];
  readonly path: readonly string[];
  readonly numbering: ListNumbering;
  readonly definition: NumberingConfig;
};

/** What expanding Lists takes from the document: fresh numbering instances, so that separate lists number
 *  separately, and the levels each type numbers with. */
type ListContext = { readonly nextInstance: () => number; readonly levels: ListLevels };

/** A list definition, and why each level it leaves out is left out, for the item that needs one. */
type Definition = { readonly config: NumberingConfig; readonly missing: (level: number) => string };

/** Where a List sits: its type and depth, its definition, and its numbering. */
type Nesting = {
  readonly type: ListType;
  readonly depth: number;
  readonly definition: Definition;
  readonly numbering: ListNumbering;
};

function listType(list: AuthorNode): ListType {
  return list.props.type === "numbered" ? "NumberedList" : "BulletList";
}

/** The definition for lists of `type` whose level 0 sits at depth `start`: "NumberedList" at depth 0, and
 *  "NumberedList@2" for one that starts two deep below a list of the other type. The document's own config
 *  for that reference is used as it is. Otherwise "NumberedList@2" is made of the type's levels from 2 on
 *  (the document's, or LIST_NUMBERING's), each moved up by 2 with its marker's level numbers. A level whose
 *  marker shows the number of a level above 2 is left out: there that level belongs to the enclosing list. */
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

/** A nested List of its parent's type continues the parent's instance one level deeper. Any other List is
 *  level 0 of a fresh instance of the definition for its depth: docx.js restarts an instance at level 0
 *  only, and a definition of its own keeps it from counting on with an enclosing list of its type. */
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

/** The items of a List in document order, each with its numbering. A List nested directly in the List,
 *  or in one of its ListItems, contributes its items one depth deeper. */
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

/** A ListItem's non-List children form its paragraph; its nested Lists follow one level deeper. */
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
