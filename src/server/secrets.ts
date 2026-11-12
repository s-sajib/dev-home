import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Where API tokens live. Never in the SQLite database, never returned by the API. */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  del(name: string): Promise<void>;
}

export function memoryStore(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return { get: async (n) => m.get(n) ?? null, set: async (n, v) => void m.set(n, v), del: async (n) => void m.delete(n) };
}

/** Dev / non-mac fallback: a JSON file readable only by you. */
export function fileStore(path: string): SecretStore {
  const read = (): Record<string, string> => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8") || "{}") : {});
  const write = (o: Record<string, string>) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(o), { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  return {
    get: async (n) => read()[n] ?? null,
    set: async (n, v) => write({ ...read(), [n]: v }),
    del: async (n) => {
      const o = read();
      delete o[n];
      write(o);
    },
  };
}

const SERVICE = "work-inbox";

async function sec(args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["security", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out: out.trim() };
}

/** macOS Keychain via the `security` CLI. (The value is briefly visible in the process list on this single-user machine.) */
export const keychainStore: SecretStore = {
  get: async (n) => {
    const r = await sec(["find-generic-password", "-s", SERVICE, "-a", n, "-w"]);
    return r.code === 0 ? r.out : null;
  },
  set: async (n, v) => {
    const r = await sec(["add-generic-password", "-U", "-s", SERVICE, "-a", n, "-w", v]);
    if (r.code !== 0) throw new Error("Could not write to the macOS Keychain");
  },
  del: async (n) => void (await sec(["delete-generic-password", "-s", SERVICE, "-a", n])),
};

export function defaultSecretStore(dataDir = "data"): SecretStore {
  return process.platform === "darwin" ? keychainStore : fileStore(`${dataDir}/secrets.json`);
}
