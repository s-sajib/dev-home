import { useSyncExternalStore } from "react";

/**
 * Tiny external store for "which inbox row is selected". Rows subscribe with a boolean selector, so a keypress
 * re-renders exactly the two rows whose state changed instead of reconciling hundreds of them.
 */
let current: string | null = null;
const subs = new Set<() => void>();
export const selection = {
  get: () => current,
  set(key: string | null) { if (key !== current) { current = key; subs.forEach((f) => f()); } },
  subscribe(f: () => void) { subs.add(f); return () => void subs.delete(f); },
};
export const useIsSelected = (key: string) => useSyncExternalStore(selection.subscribe, () => selection.get() === key);
