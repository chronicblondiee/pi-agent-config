/**
 * Protected Paths Extension
 *
 * Blocks write/edit tool calls targeting sensitive files and directories.
 * Complements claude-mode by catching mistakes even in /yolo mode.
 *
 * Commands:
 *   /trust-paths       — list current protected patterns
 *   /unprotect <path>  — allow writes to a specific path (this session only)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Pattern =
  | { kind: "dir"; name: string } // .git/, node_modules/
  | { kind: "dotPrefix"; name: string } // .env  → matches .env and .env.*
  | { kind: "exact"; name: string } // id_rsa
  | { kind: "subpath"; path: string }; // .docker/config.json

const DEFAULT_PATTERNS: Pattern[] = [
  // Secrets / credentials
  { kind: "dotPrefix", name: ".env" },
  { kind: "exact", name: ".npmrc" },
  { kind: "exact", name: ".pypirc" },
  { kind: "exact", name: ".netrc" },
  { kind: "subpath", path: ".docker/config.json" },
  // Version-control internals
  { kind: "dir", name: ".git" },
  { kind: "dir", name: ".hg" },
  { kind: "dir", name: ".svn" },
  // Dependency / build dirs
  { kind: "dir", name: "node_modules" },
  { kind: "dir", name: "__pycache__" },
  { kind: "dir", name: ".venv" },
  { kind: "dir", name: "venv" },
  { kind: "dir", name: ".cache" },
  // System / SSH / GPG
  { kind: "dir", name: ".ssh" },
  { kind: "dir", name: ".gnupg" },
  { kind: "exact", name: "id_rsa" },
  { kind: "exact", name: "id_ed25519" },
];

function describe(p: Pattern): string {
  switch (p.kind) {
    case "dir": return `${p.name}/`;
    case "dotPrefix": return `${p.name}[.*]`;
    case "exact": return p.name;
    case "subpath": return p.path;
  }
}

function matches(path: string, p: Pattern): boolean {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const basename = segments[segments.length - 1] ?? "";
  switch (p.kind) {
    case "dir":
      return segments.includes(p.name);
    case "exact":
      return basename === p.name;
    case "dotPrefix":
      return basename === p.name || basename.startsWith(p.name + ".");
    case "subpath":
      return path === p.path || path.endsWith("/" + p.path);
  }
}

export default function (pi: ExtensionAPI): void {
  const patterns = [...DEFAULT_PATTERNS];
  const unprotected = new Set<string>();

  function isProtected(path: string): Pattern | null {
    if (unprotected.has(path)) return null;
    return patterns.find((p) => matches(path, p)) ?? null;
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;

    const path = String(event.input.path ?? "");
    if (!path) return;

    const hit = isProtected(path);
    if (!hit) return;

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
    }
    return { block: true, reason: `Path "${path}" matches protected pattern ${describe(hit)}` };
  });

  pi.registerCommand("trust-paths", {
    description: "Show protected path patterns",
    handler: async (_args, ctx) => {
      const lines = [
        `Protected patterns (${patterns.length}):`,
        ...patterns.map((p) => `  - ${describe(p)}`),
      ];
      if (unprotected.size > 0) {
        lines.push("", `Unprotected this session (${unprotected.size}):`);
        for (const p of unprotected) lines.push(`  - ${p}`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("unprotect", {
    description: "Allow writes to a specific path for this session",
    handler: async (args, ctx) => {
      const path = args?.trim();
      if (!path) {
        ctx.ui.notify("Usage: /unprotect <path>", "warning");
        return;
      }
      unprotected.add(path);
      ctx.ui.notify(`Unprotected: ${path}`, "info");
    },
  });
}
