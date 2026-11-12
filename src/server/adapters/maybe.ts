/** A value, or a function returning the current value (so adapters pick up settings changes live). */
export type Maybe<T> = T | null | (() => T | null);
export function current<T>(x: Maybe<T>): T | null {
  return typeof x === "function" ? (x as () => T | null)() : x;
}
