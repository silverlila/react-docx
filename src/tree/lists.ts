import type * as docx from "docx";
import { TreeError, type AuthorNode, type IndexedChild } from "./canonical";

type NumberingConfig = docx.INumberingOptions["config"][number];
type Level = NumberingConfig["levels"][number];

const LEVEL_COUNT = 9;
const NUMBERED_FORMATS = ["decimal", "lowerLetter", "lowerRoman"] as const;
const BULLET_SYMBOLS = ["•", "◦", "▪"] as const;

function level(n: number, format: Level["format"], text: string): Level {
  return {
    level: n,
    format,
    text,
    alignment: "left",
    style: { paragraph: { indent: { left: 720 * (n + 1), hanging: 360 } } },
  };
}

function levels(make: (n: number) => Level): Level[] {
  return Array.from({ length: LEVEL_COUNT }, (_, n) => make(n));
}

/** Levels 0–8 for "NumberedList" and "BulletList". Level 0 is identical to today's DEFAULT_NUMBERING (src/constants.ts). */
export const LIST_NUMBERING: { readonly config: readonly NumberingConfig[] } = {
  config: [
    { reference: "NumberedList", levels: levels((n) => level(n, NUMBERED_FORMATS[n % 3], `%${n + 1}.`)) },
    { reference: "BulletList", levels: levels((n) => level(n, "bullet", BULLET_SYMBOLS[n % 3])) },
  ],
};

export type ListReference = "NumberedList" | "BulletList";

/** One paragraph a List expands into: the item, its own content (nested Lists excluded), and its depth. */
export type ListEntry = {
  readonly item: AuthorNode;
  readonly content: readonly IndexedChild[];
  readonly path: readonly string[];
  readonly level: number;
};

export function listReference(list: AuthorNode): ListReference {
  return list.props.type === "numbered" ? "NumberedList" : "BulletList";
}

/** The items of a List in document order, each with its nesting depth. A List nested directly
 *  in the List, or in one of its ListItems, contributes its items at the next level. */
export function listEntries(list: AuthorNode, path: readonly string[], depth = 0): ListEntry[] {
  if (list.props.level !== undefined) {
    throw new TreeError(path, "List.level was removed; nest <List> instead");
  }
  const entries: ListEntry[] = [];
  list.children.forEach((child, index) => {
    if (typeof child === "string") throw new TreeError(path, "Text is not allowed directly in <List>");
    const childPath = [...path, `${child.type}[${index}]`];
    if (child.type === "List") {
      entries.push(...listEntries(child, childPath, depth + 1));
    } else if (child.type === "ListItem") {
      entries.push(...itemEntries(child, childPath, depth));
    } else {
      throw new TreeError(childPath, `<${child.type}> is not allowed in <List>`);
    }
  });
  return entries;
}

/** A ListItem's non-List children form its paragraph; its nested Lists follow at depth + 1. */
function itemEntries(item: AuthorNode, path: readonly string[], depth: number): ListEntry[] {
  const content: IndexedChild[] = [];
  const nested: ListEntry[] = [];
  item.children.forEach((child, index) => {
    if (typeof child !== "string" && child.type === "List") {
      nested.push(...listEntries(child, [...path, `List[${index}]`], depth + 1));
    } else {
      content.push({ child, index });
    }
  });
  return [{ item, content, path, level: depth }, ...nested];
}
