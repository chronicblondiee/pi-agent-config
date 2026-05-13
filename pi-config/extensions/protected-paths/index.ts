/**
 * Protected Paths Extension
 *
 * Blocks write/edit tool calls targeting sensitive files and directories.
 * Complements claude-mode by catching mistakes even in /yolo mode.
 *
 * Per-project config: drop a `.pi/protected-paths.json` in the project
 * root to extend (or replace) the defaults. Schema:
 *   { "replace": false, "patterns": [ { "kind": "dir", "name": "dist" } ] }
 * Pattern kinds: "dir" (any segment match), "exact" (basename match),
 * "dotPrefix" (basename === name OR basename starts with name + "."),
 * "subpath" (full or trailing path match).
 *
 * Commands:
 *   /trust-paths       — list current protected patterns
 *   /unprotect <path>  — allow writes to a specific path (this session only)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

function parsePattern(raw: unknown): Pattern | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind : null;
  switch (kind) {
    case "dir":
    case "exact":
    case "dotPrefix":
      return typeof o.name === "string" && o.name.length > 0
        ? ({ kind, name: o.name } as Pattern)
        : null;
    case "subpath":
      return typeof o.path === "string" && o.path.length > 0
        ? { kind: "subpath", path: o.path }
        : null;
    default:
      return null;
  }
}

async function loadProjectConfig(): Promise<{ patterns: Pattern[]; replace: boolean; source: string } | null> {
  const path = resolve(process.cwd(), ".pi/protected-paths.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { patterns: [], replace: false, source: `${path} (invalid JSON, ignored)` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { patterns: [], replace: false, source: `${path} (not an object, ignored)` };
  }
  const cfg = parsed as Record<string, unknown>;
  const replace = cfg.replace === true;
  const rawList = Array.isArray(cfg.patterns) ? cfg.patterns : [];
  const patterns: Pattern[] = [];
  for (const raw of rawList) {
    const p = parsePattern(raw);
    if (p) patterns.push(p);
  }
  return { patterns, replace, source: path };
}

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
  let patterns: Pattern[] = [...DEFAULT_PATTERNS];
  let configSource: string | null = null;
  let configMode: "defaults" | "extended" | "replaced" = "defaults";
  const unprotected = new Set<string>();

  function isProtected(path: string): Pattern | null {
    if (unprotected.has(path)) return null;
    return patterns.find((p) => matches(path, p)) ?? null;
  }

  pi.on("session_start", async (_event, ctx) => {
    const cfg = await loadProjectConfig();
    if (!cfg) {
      patterns = [...DEFAULT_PATTERNS];
      configMode = "defaults";
      configSource = null;
      return;
    }
    configSource = cfg.source;
    if (cfg.replace) {
      patterns = cfg.patterns.length ? [...cfg.patterns] : [...DEFAULT_PATTERNS];
      configMode = cfg.patterns.length ? "replaced" : "defaults";
    } else {
      patterns = [...DEFAULT_PATTERNS, ...cfg.patterns];
      configMode = cfg.patterns.length ? "extended" : "defaults";
    }
    if (ctx.hasUI && cfg.patterns.length) {
      ctx.ui.notify(
        `protected-paths: loaded ${cfg.patterns.length} pattern(s) from .pi/protected-paths.json (${configMode})`,
        "info",
      );
    }
  });

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
      const header = configSource
        ? `Protected patterns (${patterns.length}, ${configMode} from ${configSource}):`
        : `Protected patterns (${patterns.length}, defaults only):`;
      const lines = [header, ...patterns.map((p) => `  - ${describe(p)}`)];
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
