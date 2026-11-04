export const isOwnKey = <T extends object>(table: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(table, key);

export const own = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined =>
  isOwnKey(table, key) ? table[key] : undefined;
