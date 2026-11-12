/** Keyboard actions and their default keys. Shared by the server (validation) and the UI (dispatch). */
export const ACTIONS = {
  down: { label: "Move down", key: "j" },
  up: { label: "Move up", key: "k" },
  open: { label: "Open link", key: "o" },
  accept: { label: "Accept", key: "a" },
  dismiss: { label: "Dismiss", key: "d" },
  snooze: { label: "Snooze", key: "s" },
  remind: { label: "Make a reminder", key: "r" },
  complete: { label: "Complete reminder", key: "x" },
  transition: { label: "Jira transition", key: "t" },
  comment: { label: "Jira comment", key: "m" },
  summarize: { label: "Summarise chat", key: "z" },
  mode: { label: "Cycle chat Claude mode", key: "w" },
  draft: { label: "Draft reply", key: "c" },
  copy: { label: "Copy draft", key: "y" },
  group: { label: "Toggle grouping", key: "v" },
  judge: { label: "Judge now", key: "i" },
  refresh: { label: "Refresh", key: "g" },
  undo: { label: "Undo", key: "u" },
  addToBoard: { label: "Add to board", key: "b" },
  viewInbox: { label: "Go to Inbox", key: "1" },
  viewBoard: { label: "Go to Board", key: "2" },
  colLeft: { label: "Board: column left", key: "h" },
  colRight: { label: "Board: column right", key: "l" },
  moveLeft: { label: "Board: move card left", key: "[" },
  moveRight: { label: "Board: move card right", key: "]" },
  newCard: { label: "Board: new card", key: "n" },
  settings: { label: "Open settings", key: "," },
  help: { label: "Help", key: "?" },
} as const;

export type ActionId = keyof typeof ACTIONS;
export type Keymap = Record<ActionId, string>;

export const DEFAULT_KEYMAP = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.key])) as Keymap;

/** Keys that stay reserved (not rebindable) so the UI can always be escaped or navigated. */
export const RESERVED_KEYS = ["Escape", "Enter", "ArrowUp", "ArrowDown"];

/** Merge a partial saved keymap over the defaults. Unknown actions are ignored. */
export function resolveKeymap(saved: unknown): Keymap {
  const out = { ...DEFAULT_KEYMAP };
  if (saved && typeof saved === "object") {
    for (const [a, k] of Object.entries(saved as Record<string, unknown>)) {
      if (a in ACTIONS && typeof k === "string" && k.length > 0) out[a as ActionId] = k;
    }
  }
  return out;
}

/** Throws on duplicates, reserved keys or unknown actions. */
export function validateKeymap(input: unknown): Keymap {
  if (!input || typeof input !== "object") throw new Error("keymap must be an object");
  for (const a of Object.keys(input as object)) if (!(a in ACTIONS)) throw new Error(`unknown action "${a}"`);
  const map = resolveKeymap(input);
  const seen = new Map<string, string>();
  for (const [a, k] of Object.entries(map)) {
    if (RESERVED_KEYS.includes(k)) throw new Error(`"${k}" is reserved`);
    if (k.length !== 1 && !/^F\d{1,2}$/.test(k)) throw new Error(`"${k}" is not a single key`);
    if (seen.has(k)) throw new Error(`"${k}" is used by both ${seen.get(k)} and ${a}`);
    seen.set(k, a);
  }
  return map;
}
