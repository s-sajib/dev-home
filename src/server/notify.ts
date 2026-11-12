export interface Notification {
  title: string;
  body: string;
  /** Opened when the notification is clicked (terminal-notifier only) */
  openUrl?: string;
}
export type Notifier = (n: Notification) => Promise<void>;

const asq = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** macOS notification. Prefers terminal-notifier (click opens the inbox); falls back to osascript. */
export const macNotifier: Notifier = async (n) => {
  const tn = Bun.which("terminal-notifier");
  const args = tn
    ? [tn, "-title", n.title, "-message", n.body, "-group", "work-inbox", ...(n.openUrl ? ["-open", n.openUrl] : [])]
    : ["osascript", "-e", `display notification ${asq(n.body)} with title ${asq(n.title)}`];
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(`notification failed: ${(await new Response(proc.stderr).text()).slice(0, 200)}`);
};

/** Used in demo / non-mac runs and tests. */
export const consoleNotifier: Notifier = async (n) => console.log(`[notify] ${n.title} — ${n.body}`);
