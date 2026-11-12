export {};
/** Restarts a command whenever it exits (a tiny launchd/pm2 stand-in for crash-recovery tests). */
const cmd = process.argv.slice(2);
if (cmd.length === 0) { console.error("usage: bun scripts/supervise.ts <command...>"); process.exit(2); }
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; child?.kill(); process.exit(0); });
let child: ReturnType<typeof Bun.spawn> | undefined;
while (!stopping) {
  child = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit", env: process.env });
  const code = await child.exited;
  if (stopping) break;
  console.log(`[supervise] exited with ${code}, restarting in 700ms`);
  await new Promise((r) => setTimeout(r, 700));
}
