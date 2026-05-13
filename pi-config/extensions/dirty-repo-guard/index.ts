/**
 * Dirty Repo Guard Extension
 *
 * Warns before /new, /resume, /fork, or session exit when the working
 * tree has uncommitted changes. In headless modes (`-p`, no UI) the
 * guard never blocks — there is no way to prompt the user.
 *
 * Reports staged vs unstaged separately. A file with both staged and
 * unstaged changes counts toward both — same file, two distinct
 * pending edits.
 *
 * Commands:
 *   /dirty   — check current working-tree state
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface DirtyCounts {
  total: number;
  staged: number;
  unstaged: number;
}

const CLEAN: DirtyCounts = { total: 0, staged: 0, unstaged: 0 };

async function inspectDirty(pi: ExtensionAPI): Promise<DirtyCounts> {
  try {
    const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
    if (code !== 0) return CLEAN;
    const lines = stdout.split("\n").filter(Boolean);
    let staged = 0;
    let unstaged = 0;
    for (const line of lines) {
      const x = line[0] ?? " ";
      const y = line[1] ?? " ";
      // Untracked / ignored files have X='?' or '!'; they're only "unstaged."
      if (x !== " " && x !== "?" && x !== "!") staged++;
      if (y !== " " || x === "?") unstaged++;
    }
    return { total: lines.length, staged, unstaged };
  } catch {
    return CLEAN;
  }
}

function summarize(c: DirtyCounts): string {
  if (c.unstaged && c.staged) return `${c.total} dirty (${c.unstaged} unstaged, ${c.staged} staged)`;
  if (c.unstaged) return `${c.unstaged} unstaged file(s)`;
  if (c.staged) return `${c.staged} staged file(s)`;
  return `${c.total} file(s)`;
}

async function guard(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  action: string,
): Promise<{ cancel: boolean } | undefined> {
  const counts = await inspectDirty(pi);
  if (counts.total === 0) return;

  // Without a UI we cannot ask the user — let the action through rather
  // than silently cancelling. Headless callers can check /dirty first.
  if (!ctx.hasUI) return;

  const choice = await ctx.ui.select(
    `${summarize(counts)}. ${action} anyway?`,
    ["Yes, proceed anyway", "No, let me commit first"],
  );

  if (choice !== "Yes, proceed anyway") {
    ctx.ui.notify("Commit your changes first", "warning");
    return { cancel: true };
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("session_before_switch", async (event, ctx) => {
    const action = event.reason === "new" ? "start a new session" : "switch session";
    return guard(pi, ctx, action);
  });

  pi.on("session_before_fork", async (_event, ctx) => guard(pi, ctx, "fork"));

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    const counts = await inspectDirty(pi);
    if (counts.total === 0) return;

    ctx.ui.notify(
      `Session ending with ${summarize(counts)}. Don't forget to commit!`,
      "warning",
    );
  });

  pi.registerCommand("dirty", {
    description: "Check for uncommitted changes",
    handler: async (_args, ctx) => {
      const counts = await inspectDirty(pi);
      if (counts.total === 0) {
        ctx.ui.notify("Working tree is clean", "success");
        return;
      }
      ctx.ui.notify(summarize(counts), "warning");
    },
  });
}
