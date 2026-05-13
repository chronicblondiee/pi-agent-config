/**
 * Git Checkpoint Extension
 *
 * Creates a git commit before each agent turn so edits can be reverted
 * if something goes wrong. On /fork, persists a restore request via a
 * custom session entry; the forked session reads it on startup and
 * resets the working tree to that checkpoint.
 *
 * Commands:
 *   /checkpoint   — manual checkpoint (commits current state)
 *   /checkpoints  — list recent checkpoints from this session
 *   /restore <sha> — reset working tree to a specific checkpoint
 *
 * Caveat: this rewrites your commit history while pi is running. If you
 * use a staging-heavy workflow (interactive `git add -p`, etc.) outside
 * pi, disable this extension or expect your index to be repeatedly
 * flattened by `git add -A`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Checkpoint {
  entryId: string;
  sha: string;
  timestamp: number;
  message?: string;
}

export default function (pi: ExtensionAPI): void {
  const checkpoints = new Map<string, Checkpoint>();
  let inGitRepo = false;
  let restoreProcessedFor: string | null = null;

  async function isGitRepo(): Promise<boolean> {
    try {
      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      return code === 0;
    } catch {
      return false;
    }
  }

  async function hasChanges(): Promise<boolean> {
    try {
      const { stdout } = await pi.exec("git", ["status", "--porcelain", "-unormal"]);
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
      await pi.exec("git", ["add", "-A"]);
      const ts = new Date().toISOString();
      await pi.exec("git", [
        "commit",
        "--allow-empty",
        "-m",
        `[pi-checkpoint] ${message} (${ts})`,
      ]);

      const { stdout } = await pi.exec("git", ["rev-parse", "HEAD"]);
      const sha = stdout.trim();

      const entryId = ctx?.sessionManager.getLeafId() ?? "unknown";
      checkpoints.set(entryId, { entryId, sha, timestamp: Date.now(), message });

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
      await pi.exec("git", ["reset", "--hard", sha]);
      // reset --hard only touches tracked files; clean removes any
      // untracked files the agent created after the checkpoint so the
      // working tree truly matches the checkpoint state. .gitignore is
      // respected (no -x), so genuinely ignored files survive.
      await pi.exec("git", ["clean", "-fd"]);
      ctx.ui.notify(`Restored to checkpoint ${sha.slice(0, 8)}`, "success");
    } catch (err) {
      ctx.ui.notify(`Restore failed: ${err}`, "error");
    }
  }

  pi.on("session_start", async (event, ctx) => {
    inGitRepo = await isGitRepo();
    if (!inGitRepo) {
      if (ctx.hasUI) ctx.ui.setStatus("git-checkpoint", "not a git repo");
      return;
    }

    // Only consume a pending restore request when this session_start is the
    // one *caused* by a fork, and only once per session lifetime. Otherwise
    // every future resume/reload would re-trigger the same restore.
    if (event.reason !== "fork") return;
    const sessionFile = ctx.sessionManager.getSessionFile?.() ?? "ephemeral";
    if (restoreProcessedFor === sessionFile) return;

    let target: string | null = null;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === "git-checkpoint-restore" &&
        entry.data?.sha
      ) {
        target = String(entry.data.sha);
      }
    }
    if (target) {
      await restoreCheckpoint(target, ctx);
    }
    restoreProcessedFor = sessionFile;
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!inGitRepo) return;
    if (!(await hasChanges())) return;

    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;
    if (checkpoints.has(leafId)) return;

    await createCheckpoint("before turn", ctx);
  });

  pi.on("session_before_fork", async (event, ctx) => {
    const cp = checkpoints.get(event.entryId);
    if (!cp || !ctx.hasUI) return;

    const choice = await ctx.ui.select("Restore code at fork?", [
      `Yes — restore to ${cp.sha.slice(0, 8)}`,
      "No — keep current state",
    ]);

    if (choice?.startsWith("Yes")) {
      pi.appendEntry("git-checkpoint-restore", { sha: cp.sha });
    }
  });

  pi.registerCommand("checkpoint", {
    description: "Create a manual git checkpoint",
    handler: async (args, ctx) => {
      if (!inGitRepo) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      const sha = await createCheckpoint(args || "manual checkpoint", ctx);
      if (sha) ctx.ui.notify(`Checkpoint created: ${sha.slice(0, 8)}`, "success");
      else ctx.ui.notify("Checkpoint failed", "error");
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
      ctx.ui.notify(`Recent checkpoints:\n${lines.join("\n")}`, "info");
    },
  });

  pi.registerCommand("restore", {
    description: "Reset working tree to a checkpoint SHA",
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
