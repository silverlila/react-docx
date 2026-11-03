import type * as docx from "docx";
import { TreeError, type AuthorNode, type IndexedChild } from "./canonical";

type NumberingConfig = docx.INumberingOptions["config"][number];
type Level = NumberingConfig["levels"][number];
type ListType = "NumberedList" | "BulletList";

const LEVEL_COUNT = 9;
const NUMBERED_FORMATS = ["decimal", "lowerLetter", "lowerRoman"] as const;
const BULLET_SYMBOLS = ["•", "◦", "▪"] as const;

/** Level `n` of a definition whose level 0 sits at list depth `depth`: its marker and indent are the depth's. */
function level(type: ListType, depth: number, n: number): Level {
  const at = depth + n;
  const marker =
    type === "NumberedList"
      ? { format: NUMBERED_FORMATS[at % 3], text: `%${n + 1}.` }
      : { format: "bullet" as const, text: BULLET_SYMBOLS[at % 3] };
  return { level: n, ...marker, alignment: "left", style: { paragraph: { indent: { left: 720 * (at + 1), hanging: 360 } } } };
}

/** The numbering definition for lists of `type` that start at `depth`: "NumberedList" at depth 0,
 *  "NumberedList@2" for one that starts two deep below a list of the other type. */
function listDefinition(type: ListType, depth: number): NumberingConfig {
  return {
    reference: depth === 0 ? type : `${type}@${depth}`,
    levels: Array.from({ length: LEVEL_COUNT - depth }, (_, n) => level(type, depth, n)),
  };
}

/** Levels 0–8 for "NumberedList" and "BulletList". Level 0 of each is 0.1.8's DEFAULT_NUMBERING. */
export const LIST_NUMBERING: { readonly config: readonly NumberingConfig[] } = {
  config: [listDefinition("NumberedList", 0), listDefinition("BulletList", 0)],
};

/** A list paragraph's numbering: which list definition, how deep in it, and which instance of it. */
export type ListNumbering = { readonly reference: string; readonly level: number; readonly instance: number };

/** One paragraph a List expands into: the item, its own content (nested Lists excluded), its numbering,
 *  and the definition that numbering names. */
export type ListEntry = {
  readonly item: AuthorNode;
  readonly content: readonly IndexedChild[];
  readonly path: readonly string[];
  readonly numbering: ListNumbering;
  readonly definition: NumberingConfig;
};

/** Where a List sits: its type, definition and numbering. */
type Nesting = { readonly type: ListType; readonly definition: NumberingConfig; readonly numbering: ListNumbering };

function listType(list: AuthorNode): ListType {
  return list.props.type === "numbered" ? "NumberedList" : "BulletList";
}

/** A nested List of its parent's type continues the parent's instance one level deeper. Any other List is
 *  level 0 of a fresh instance of the definition for its depth: docx.js restarts an instance at level 0
 *  only, and a definition of its own keeps it from counting on with an enclosing list of its type. */
function nestingOf(list: AuthorNode, parent: Nesting | undefined, depth: number, nextInstance: () => number): Nesting {
  const type = listType(list);
  if (parent !== undefined && type === parent.type) {
    const { reference, level, instance } = parent.numbering;
    return { ...parent, numbering: { reference, level: level + 1, instance } };
  }
  const definition = listDefinition(type, depth);
  return { type, definition, numbering: { reference: definition.reference, level: 0, instance: nextInstance() } };
}

/** The items of a List in document order, each with its numbering. A List nested directly in the List,
 *  or in one of its ListItems, contributes its items one depth deeper. `nextInstance` hands out a fresh
 *  numbering instance, so that separate lists number separately. */
export function listEntries(
  list: AuthorNode,
  path: readonly string[],
  nextInstance: () => number,
  parent?: Nesting,
  depth = 0
): ListEntry[] {
  if (list.props.level !== undefined) {
    throw new TreeError(path, "List.level was removed; nest <List> instead");
  }
  if (depth >= LEVEL_COUNT) throw new TreeError(path, `Lists nest at most ${LEVEL_COUNT} deep: Word numbers ${LEVEL_COUNT} levels`);
  const nesting = nestingOf(list, parent, depth, nextInstance);
  const entries: ListEntry[] = [];
  list.children.forEach((child, index) => {
    if (typeof child === "string") throw new TreeError(path, "Text is not allowed directly in <List>");
    const childPath = [...path, `${child.type}[${index}]`];
    if (child.type === "List") {
      entries.push(...listEntries(child, childPath, nextInstance, nesting, depth + 1));
    } else if (child.type === "ListItem") {
      entries.push(...itemEntries(child, childPath, nextInstance, nesting, depth));
    } else {
      throw new TreeError(childPath, `<${child.type}> is not allowed in <List>`);
    }
  });
  return entries;
}

/** A ListItem's non-List children form its paragraph; its nested Lists follow one level deeper. */
function itemEntries(
  item: AuthorNode,
  path: readonly string[],
  nextInstance: () => number,
  nesting: Nesting,
  depth: number
): ListEntry[] {
  const content: IndexedChild[] = [];
  const nested: ListEntry[] = [];
  item.children.forEach((child, index) => {
    if (typeof child !== "string" && child.type === "List") {
      nested.push(...listEntries(child, [...path, `List[${index}]`], nextInstance, nesting, depth + 1));
    } else {
      content.push({ child, index });
    }
  });
  return [{ item, content, path, numbering: nesting.numbering, definition: nesting.definition }, ...nested];
}
