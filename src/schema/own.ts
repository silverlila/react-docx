/** Own-key lookups into plain lookup tables, so a key such as "constructor" or "__proto__" is not found on
 *  Object.prototype. tsconfig's lib (ES2020) has no Object.hasOwn. No imports: every bundle uses this. */

export const isOwnKey = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(table, key);

export const own = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined =>
  isOwnKey(table, key) ? table[key] : undefined;
