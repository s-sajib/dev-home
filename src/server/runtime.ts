import type { Flag } from "./types";

/** Small bits of live configuration the pure modules (rules, inbox, chat modes) consult without taking `cfg` everywhere. */
export interface Runtime {
  ignoreAuthors: string[];
  disabledFlags: Flag[];
  chatDefaultMode: "manual" | "never";
}

export const runtime: Runtime = { ignoreAuthors: [], disabledFlags: [], chatDefaultMode: "manual" };

export function configureRuntime(r: Partial<Runtime>) {
  Object.assign(runtime, r);
}
