/** Reader-assigned ids (decision 5): numbers given by order of first appearance instead of the file's ids,
 *  which differ between Word and docx.js output. Each space (bookmarks, lists, comments) counts on its own. */

export type Ordinals = (space: string, sourceKey: string) => number;

/** The same (space, key) gives the same number; the first key seen in a space is 1. */
export function createOrdinals(): Ordinals {
  const spaces = new Map<string, Map<string, number>>();
  return (space, sourceKey) => {
    const numbers = spaces.get(space) ?? new Map<string, number>();
    spaces.set(space, numbers);
    const known = numbers.get(sourceKey);
    if (known !== undefined) return known;
    const number = numbers.size + 1;
    numbers.set(sourceKey, number);
    return number;
  };
}
