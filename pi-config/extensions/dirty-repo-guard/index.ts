/**
 * Dirty Repo Guard Extension
 *
 * Warns before /new, /resume, /fork, or session exit when the working
 * tree has uncommitted changes. In headless modes (`-p`, no UI) the
 * guard never blocks — there is no way to prompt the user.
 *
 * Commands:
 *   /dirty   — check current working-tree state
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

async function countDirty(pi: ExtensionAPI): Promise<number> {
  try {
    const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
    if (code !== 0) return 0;
    return stdout.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function guard(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  action: string,
): Promise<{ cancel: boolean } | undefined> {
  const count = await countDirty(pi);
  if (count === 0) return;

  // Without a UI we cannot ask the user — let the action through rather
  // than silently cancelling. Headless callers can check /dirty first.
  if (!ctx.hasUI) return;

  const choice = await ctx.ui.select(
    `You have ${count} uncommitted file(s). ${action} anyway?`,
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
    const count = await countDirty(pi);
    if (count === 0) return;

    ctx.ui.notify(
      `Session ending with ${count} uncommitted file(s). Don't forget to commit!`,
      "warning",
    );
  });

  pi.registerCommand("dirty", {
    description: "Check for uncommitted changes",
    handler: async (_args, ctx) => {
      const count = await countDirty(pi);
      if (count === 0) ctx.ui.notify("Working tree is clean", "success");
      else ctx.ui.notify(`${count} uncommitted file(s)`, "warning");
    },
  });
}
