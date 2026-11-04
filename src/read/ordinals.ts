export type Ordinals = (space: string, sourceKey: string) => number;

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
