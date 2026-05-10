/**
 * Protected Paths Extension
 *
 * Blocks write and edit operations to sensitive files and directories.
 * Complements claude-mode by catching mistakes even in yolo mode.
 *
 * Commands:
 *   /trust-paths   — show current protected path list
 *   /unprotect <path> — temporarily allow writes to a specific path
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_PROTECTED = [
  // Secrets / credentials
  ".env",
  ".env.",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".docker/config.json",
  // Version control internals
  ".git/",
  ".hg/",
  ".svn/",
  // Dependency directories
  "node_modules/",
  "__pycache__/",
  ".venv/",
  "venv/",
  ".cache/",
  // System / config
  ".ssh/",
  ".gnupg/",
  "id_rsa",
  "id_ed25519",
];

export default function (pi: ExtensionAPI): void {
  const protectedPatterns = new Set(DEFAULT_PROTECTED);
  const temporarilyUnprotected = new Set<string>();

  function isProtected(path: string): boolean {
    if (temporarilyUnprotected.has(path)) return false;
    return Array.from(protectedPatterns).some((p) => path.includes(p));
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const path = String(event.input.path ?? "<unknown>");
    if (!isProtected(path)) return;

    if (ctx.hasUI) {
      ctx.ui.notify(
        `Blocked write to protected path: ${path}`,
        "warning",
      );
    }
    return { block: true, reason: `Path "${path}" is protected` };
  });

  pi.registerCommand("trust-paths", {
    description: "Show protected path list",
    handler: async (_args, ctx) => {
      const lines = [
        `Protected patterns (${protectedPatterns.size}):`,
        ...Array.from(protectedPatterns).map((p) => `  - ${p}`),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("unprotect", {
    description: "Temporarily allow writes to a specific path",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /unprotect <path>", "warning");
        return;
      }
      temporarilyUnprotected.add(args.trim());
      ctx.ui.notify(`Unprotected: ${args.trim()}`, "info");
    },
  });
}
