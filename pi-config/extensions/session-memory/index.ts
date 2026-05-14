/**
 * session-memory: persistent per-project notes for pi.
 *
 * Pi sessions start fresh — there's no equivalent of Claude Code's
 * auto-memory, so the model re-learns the project every time. This
 * extension closes that gap by keeping a per-project JSON memory file
 * and injecting its contents into the system prompt on every turn.
 *
 * Storage:
 *   ~/.pi/agent/memory/<slug>.json
 *   { path, createdAt, entries: [{ id, ts, body }] }
 *   Slug is derived from the absolute cwd at session start — readable
 *   ("home_brown_projects_pi-agent-config") so the user can inspect
 *   files directly.
 *
 * LLM-facing surface:
 *   - `remember(body)` tool       — append a note
 *   - `forget(id)` tool           — remove a note by id
 *   On every turn the system prompt gains a `## Session memory` section
 *   with the current entries via `before_agent_start`. Persists across
 *   compaction (since the system prompt is re-applied each turn).
 *
 * User-facing slash commands:
 *   - /memory          — show the current project's memory
 *   - /memory-clear    — wipe the current project's memory
 *   - /remember <text> — append a note manually (skips the LLM)
 *
 * Pairs with claude-mode: `remember` / `forget` are added to BOTH
 * ASK_TOOLS and PLAN_TOOLS — no file writes touch the project itself,
 * only `~/.pi/agent/memory/`, so they're safe in plan mode.
 *
 * Design choice: this is a flat list of bulleted notes, not typed
 * facts/preferences/etc. Kept deliberately simple — if the model wants
 * structure it can encode it inside the body, and the user can edit
 * the JSON file directly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MEMORY_DIR = join(homedir(), ".pi", "agent", "memory");
const MAX_ENTRIES_INJECTED = 50;
const MAX_BODY_CHARS = 2000;

interface MemoryEntry {
  id: number;
  ts: number;
  body: string;
}

interface MemoryFile {
  path: string;
  createdAt: number;
  entries: MemoryEntry[];
}

function pathSlug(p: string): string {
  const abs = resolve(p);
  const cleaned = abs.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "root";
}

function memoryFileFor(cwd: string): string {
  return join(MEMORY_DIR, `${pathSlug(cwd)}.json`);
}

function loadMemory(cwd: string): MemoryFile {
  const file = memoryFileFor(cwd);
  if (!existsSync(file)) {
    return { path: resolve(cwd), createdAt: Date.now(), entries: [] };
  }
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as MemoryFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { path: resolve(cwd), createdAt: Date.now(), entries: [] };
    }
    return parsed;
  } catch {
    // Corrupt file — start fresh rather than crashing the session.
    return { path: resolve(cwd), createdAt: Date.now(), entries: [] };
  }
}

function saveMemory(cwd: string, memory: MemoryFile): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  const file = memoryFileFor(cwd);
  writeFileSync(file, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

function nextId(entries: MemoryEntry[]): number {
  return entries.reduce((max, e) => (e.id > max ? e.id : max), 0) + 1;
}

function formatMemoryForPrompt(memory: MemoryFile): string {
  if (memory.entries.length === 0) return "";
  const shown = memory.entries.slice(-MAX_ENTRIES_INJECTED);
  const lines = [
    "## Session memory",
    `Persistent notes for this project (cwd ${memory.path}). The user has saved these across sessions — treat them as durable context.`,
    "",
    ...shown.map((e) => `- [${e.id}] ${e.body}`),
  ];
  if (memory.entries.length > shown.length) {
    lines.push(`(showing ${shown.length} of ${memory.entries.length} entries; oldest hidden)`);
  }
  return lines.join("\n");
}

const RememberParams = Type.Object({
  body: Type.String({
    description:
      "The note to remember — 1-2 sentences. Persisted to ~/.pi/agent/memory/<slug>.json and injected into the system prompt every turn. Capture facts about this project, user preferences, or context the user wouldn't want to re-explain next session.",
  }),
});

const ForgetParams = Type.Object({
  id: Type.Number({
    description: "The id of the entry to remove (shown in `/memory` and prefixed `[N]` in the system-prompt memory section).",
  }),
});

export default function sessionMemoryExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Save a note to persistent per-project memory. The note is appended to ~/.pi/agent/memory/<project-slug>.json and injected into the system prompt on every subsequent turn (including across compaction and session restarts).",
    promptSnippet:
      "Save a durable note to per-project memory that persists across sessions",
    promptGuidelines: [
      "Use `remember` for facts that should outlive this session: stable project conventions, user preferences expressed during this conversation, decisions that future-you would want to know but couldn't infer from git history.",
      "Do NOT use `remember` for transient task state (use `todo` for that), code patterns visible in the source, or anything already in CLAUDE.md/AGENTS.md/READMEs — read those instead of duplicating them in memory.",
      "Keep bodies concise — 1-2 sentences, lead with the fact, include the why if it's load-bearing.",
      "If a fact turns out to be wrong or outdated, call `forget` with its id; don't leave stale entries sitting in memory.",
    ],
    parameters: RememberParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const body = params.body.trim().slice(0, MAX_BODY_CHARS);
      if (!body) {
        return {
          content: [{ type: "text", text: "Refusing to save an empty memory entry." }],
          details: { ok: false, reason: "empty" },
        };
      }
      const cwd = process.cwd();
      const memory = loadMemory(cwd);
      const id = nextId(memory.entries);
      memory.entries.push({ id, ts: Date.now(), body });
      saveMemory(cwd, memory);
      return {
        content: [
          {
            type: "text",
            text: `Saved memory entry [${id}] (${memory.entries.length} total for ${memory.path}).`,
          },
        ],
        details: { ok: true, id, total: memory.entries.length, path: memory.path },
      };
    },
  });

  pi.registerTool({
    name: "forget",
    label: "Forget",
    description:
      "Remove an entry from per-project memory by id. Ids are shown in the `## Session memory` system-prompt block and in `/memory`.",
    promptSnippet: "Remove a persistent memory entry by id",
    promptGuidelines: [
      "Use `forget` when a previously-saved memory turns out to be wrong, outdated, or no longer useful.",
      "If you're unsure of an id, run `/memory` (or ask the user to) — don't guess.",
    ],
    parameters: ForgetParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const cwd = process.cwd();
      const memory = loadMemory(cwd);
      const idx = memory.entries.findIndex((e) => e.id === params.id);
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `No memory entry with id ${params.id}.` }],
          details: { ok: false, id: params.id },
        };
      }
      const [removed] = memory.entries.splice(idx, 1);
      saveMemory(cwd, memory);
      return {
        content: [
          {
            type: "text",
            text: `Removed entry [${removed.id}]: ${removed.body.slice(0, 120)}${removed.body.length > 120 ? "…" : ""}`,
          },
        ],
        details: { ok: true, removed, total: memory.entries.length },
      };
    },
  });

  pi.registerCommand("memory", {
    description: "Show persistent memory for the current project",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const memory = loadMemory(cwd);
      if (memory.entries.length === 0) {
        ctx.ui.notify(
          `No memory entries for ${memory.path}\nFile would be: ${memoryFileFor(cwd)}`,
          "info",
        );
        return;
      }
      const lines = [
        `Memory for ${memory.path}`,
        `(${memory.entries.length} entr${memory.entries.length === 1 ? "y" : "ies"}, file ${memoryFileFor(cwd)})`,
        "",
        ...memory.entries.map((e) => `[${e.id}] ${e.body}`),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("memory-clear", {
    description: "Wipe persistent memory for the current project",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const memory = loadMemory(cwd);
      if (memory.entries.length === 0) {
        ctx.ui.notify(`No memory entries to clear for ${memory.path}`, "info");
        return;
      }
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm(
          "Clear memory?",
          `Delete all ${memory.entries.length} entries for ${memory.path}? This cannot be undone.`,
        );
        if (!ok) return;
      }
      const cleared = memory.entries.length;
      memory.entries = [];
      saveMemory(cwd, memory);
      ctx.ui.notify(`Cleared ${cleared} memory entries for ${memory.path}`, "warning");
    },
  });

  pi.registerCommand("remember", {
    description: "Save a note to persistent memory (skips the LLM)",
    handler: async (args, ctx) => {
      const body = args?.trim();
      if (!body) {
        ctx.ui.notify("Usage: /remember <note text>", "warning");
        return;
      }
      const cwd = process.cwd();
      const memory = loadMemory(cwd);
      const id = nextId(memory.entries);
      memory.entries.push({ id, ts: Date.now(), body: body.slice(0, MAX_BODY_CHARS) });
      saveMemory(cwd, memory);
      ctx.ui.notify(
        `Saved entry [${id}] (${memory.entries.length} total for ${memory.path})`,
        "info",
      );
    },
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const memory = loadMemory(process.cwd());
    if (memory.entries.length === 0) return undefined;
    const block = formatMemoryForPrompt(memory);
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    const memory = loadMemory(process.cwd());
    if (memory.entries.length === 0) return;
    ctx.ui.notify(
      `session-memory: ${memory.entries.length} entr${memory.entries.length === 1 ? "y" : "ies"} loaded for ${memory.path}`,
      "info",
    );
  });
}
