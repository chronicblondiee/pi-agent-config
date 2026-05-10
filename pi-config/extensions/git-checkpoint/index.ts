/**
 * Git Checkpoint Extension
 *
 * Creates lightweight git commits before each agent turn so edits can be
 * reverted if something goes wrong.  On /fork, offers to restore the
 * working tree to the checkpoint at that point.
 *
 * Commands:
 *   /checkpoint   — manual checkpoint (commits current state)
 *   /checkpoints  — list recent checkpoints
 *   /restore <id> — restore working tree to a specific checkpoint
 *
 * Behavior:
 *   - Only active inside git repositories (detected via `git rev-parse --git-dir`)
 *   - Skips turns where the working tree is already clean
 *   - Uses `git stash create` + `git commit` for atomic checkpoints
 *   - Tracks checkpoint SHAs per session entry for /fork restore
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface Checkpoint {
  entryId: string;
  sha: string;
  timestamp: number;
  message?: string;
}

export default function (pi: ExtensionAPI): void {
  const checkpoints = new Map<string, Checkpoint>();
  let inGitRepo = false;

  // --- helpers ---

  async function isGitRepo(): Promise<boolean> {
    try {
      const { success } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      return success;
    } catch {
      return false;
    }
  }

  async function hasChanges(): Promise<boolean> {
    try {
      const { stdout } = await pi.exec(
        "git",
        ["status", "--porcelain", "-unormal"],
      );
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async function createCheckpoint(
    message: string,
    ctx?: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): Promise<string | null> {
    try {
      // Stage everything
      await pi.exec("git", ["add", "-A"]);

      // Commit with a machine-friendly message
      const ts = new Date().toISOString();
      const fullMsg = `[pi-checkpoint] ${message} (${ts})`;
      await pi.exec("git", [
        "commit",
        "--allow-empty",
        "-m",
        fullMsg,
      ]);

      // Record the SHA
      const { stdout } = await pi.exec("git", ["rev-parse", "HEAD"]);
      const sha = stdout.trim();

      const leaf = ctx?.sessionManager.getLeafEntry();
      const entryId = leaf?.id ?? "unknown";

      checkpoints.set(entryId, {
        entryId,
        sha,
        timestamp: Date.now(),
        message,
      });

      if (ctx?.hasUI) {
        ctx.ui.setStatus("git-checkpoint", `checkpoint: ${sha.slice(0, 8)}`);
      }

      return sha;
    } catch {
      return null;
    }
  }

  async function restoreCheckpoint(
    sha: string,
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): Promise<void> {
    try {
      // Stash current changes first so we don't lose them
      await pi.exec("git", ["stash", "push", "--include-untracked"]);
      // Hard reset to the checkpoint
      await pi.exec("git", ["reset", "--hard", sha]);
      // Apply stashed changes on top (so user's in-progress edits survive)
      const { stdout } = await pi.exec("git", ["stash", "list"]);
      if (stdout.trim().length > 0) {
        await pi.exec("git", ["stash", "pop"]);
      }

      ctx.ui.notify(`Restored to checkpoint ${sha.slice(0, 8)}`, "success");
    } catch (err) {
      ctx.ui.notify(`Restore failed: ${err}`, "error");
    }
  }

  // --- event handlers ---

  // Detect git repo on startup
  pi.on("session_start", async (_event, ctx) => {
    inGitRepo = await isGitRepo();
    if (!inGitRepo && ctx.hasUI) {
      ctx.ui.setStatus("git-checkpoint", "not a git repo");
    }
  });

  // Auto-checkpoint before each turn
  pi.on("turn_start", async (_event, ctx) => {
    if (!inGitRepo) return;
    if (!(await hasChanges())) return;

    const leaf = ctx.sessionManager.getLeafEntry();
    if (!leaf) return;

    // Don't checkpoint if we already have one for this entry this turn
    if (checkpoints.has(leaf.id)) return;

    await createCheckpoint("before turn", ctx);
  });

  // Offer restore on fork
  pi.on("session_before_fork", async (event, ctx) => {
    const cp = checkpoints.get(event.entryId);
    if (!cp || !ctx.hasUI) return;

    const choice = await ctx.ui.select("Restore code at fork?", [
      `Yes — restore to ${cp.sha.slice(0, 8)}`,
      "No — keep current state",
    ]);

    if (choice?.startsWith("Yes")) {
      // Signal that we want restore after fork completes
      // We use a session entry to survive the fork transition
      pi.appendEntry("git-checkpoint-restore", { sha: cp.sha });
    }
  });

  // After fork, check if restore was requested
  pi.on("session_start", async (_event, ctx) => {
    if (!inGitRepo) return;

    const entries = ctx.sessionManager.getEntries();
    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        entry.customType === "git-checkpoint-restore" &&
        entry.data?.sha
      ) {
        await restoreCheckpoint(entry.data.sha, ctx);
        break;
      }
    }
  });

  // --- commands ---

  pi.registerCommand("checkpoint", {
    description: "Create a manual git checkpoint",
    handler: async (args, ctx) => {
      if (!inGitRepo) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      const msg = args || "manual checkpoint";
      const sha = await createCheckpoint(msg, ctx);
      if (sha) {
        ctx.ui.notify(`Checkpoint created: ${sha.slice(0, 8)}`, "success");
      } else {
        ctx.ui.notify("Checkpoint failed", "error");
      }
    },
  });

  pi.registerCommand("checkpoints", {
    description: "List recent checkpoints",
    handler: async (_args, ctx) => {
      const list = Array.from(checkpoints.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);

      if (list.length === 0) {
        ctx.ui.notify("No checkpoints in this session", "info");
        return;
      }

      const lines = list.map(
        (cp) =>
          `${cp.sha.slice(0, 8)}  ${new Date(cp.timestamp).toLocaleTimeString()}  ${cp.message ?? "(auto)"}`,
      );
      ctx.ui.notify(
        `Recent checkpoints:\n${lines.join("\n")}`,
        "info",
      );
    },
  });

  pi.registerCommand("restore", {
    description: "Restore working tree to a checkpoint SHA",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /restore <sha>", "warning");
        return;
      }
      if (!inGitRepo) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      await restoreCheckpoint(args.trim(), ctx);
    },
  });
}
