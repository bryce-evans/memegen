/** "1 box", "2 boxes": the count plus `one`, or `many` (default `one + "s"`) when the count isn't 1. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
