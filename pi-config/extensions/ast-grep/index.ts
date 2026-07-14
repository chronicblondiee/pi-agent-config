/**
 * ast-grep: structural code-search tool for pi.
 *
 * Registers an `ast-grep` tool the LLM can call to search code by
 * tree-sitter pattern instead of plain text. Wraps the `ast-grep` CLI
 * (https://ast-grep.github.io/) and parses its `--json=stream` output.
 *
 * Why this exists:
 *   - grep/find match text; ast-grep matches AST shape — finds
 *     `console.log($A)` regardless of whitespace, finds every
 *     `function $NAME($$$ARGS) { $$$ }` declaration without false
 *     positives on the word "function" inside comments or strings
 *   - Captures meta-variables (`$NAME`, `$$$ARGS`) so the LLM gets
 *     structured bindings, not just file:line hits
 *   - Read-only, but not part of the current slim claude-mode tool sets
 *
 * Requires `ast-grep` on PATH (`pacman -S ast-grep` on Arch). If
 * missing, returns a clear error pointing at the install command.
 *
 * Pairs with claude-mode: optional extension only. The tool deliberately
 * does not expose ast-grep's `--rewrite` flag — that would mutate files,
 * bypassing claude-mode's confirmation gate. Use `edit`/`write` for changes
 * instead.
 */

import { spawn } from "node:child_process";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MAX_MATCHES = 200;
const HARD_CAP_MATCHES = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const SNIPPET_MAX_CHARS = 600;
const SNIPPET_MAX_LINES = 6;

const Strictness = StringEnum(
  ["cst", "smart", "ast", "relaxed", "signature", "template"] as const,
);

const AstGrepParams = Type.Object({
  pattern: Type.String({
    description:
      "ast-grep pattern, e.g. `console.log($A)` or `function $NAME($$$ARGS) { $$$BODY }`. Must be a complete syntactic unit for the chosen language.",
  }),
  lang: Type.Optional(
    Type.String({
      description:
        "Language of the pattern (e.g. typescript, tsx, javascript, python, rust, go, java). Required when searching directories; can be inferred from a single file's extension. See https://ast-grep.github.io/reference/languages.html",
    }),
  ),
  path: Type.Optional(
    Type.String({ description: "Path to search — file or directory. Default: current directory" }),
  ),
  globs: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "File globs to include/exclude (gitignore syntax, prefix `!` to exclude). e.g. ['src/**/*.ts', '!**/*.test.ts']",
    }),
  ),
  context: Type.Optional(
    Type.Number({ description: "Lines of context around each match (default 0)" }),
  ),
  strictness: Type.Optional(Strictness),
  max_matches: Type.Optional(
    Type.Number({
      description: `Cap total matches returned (default ${DEFAULT_MAX_MATCHES}, hard cap ${HARD_CAP_MATCHES})`,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: `Process timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, minimum ${MIN_TIMEOUT_MS})`,
    }),
  ),
});

interface AstGrepMatch {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  snippet: string;
  metavars: Record<string, string>;
}

interface AstGrepDetails {
  pattern: string;
  lang: string | null;
  path: string;
  matches: AstGrepMatch[];
  totalMatches: number;
  truncated: boolean;
  elapsedMs: number;
  exitCode: number | null;
  stderr: string;
}

interface RawMatch {
  text?: string;
  lines?: string;
  file?: string;
  range?: {
    start?: { line?: number; column?: number };
    end?: { line?: number; column?: number };
  };
  metaVariables?: {
    single?: Record<string, { text?: string }>;
    multi?: Record<string, { multiple?: Array<{ text?: string }> }>;
  };
}

function snippetOf(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  const lines = trimmed.split("\n");
  const headLines = lines.slice(0, SNIPPET_MAX_LINES).join("\n");
  if (headLines.length <= SNIPPET_MAX_CHARS) {
    const more = lines.length - SNIPPET_MAX_LINES;
    return more > 0 ? `${headLines}\n  … (+${more} lines)` : headLines;
  }
  return `${headLines.slice(0, SNIPPET_MAX_CHARS)}…`;
}

function extractMetavars(raw: RawMatch): Record<string, string> {
  const out: Record<string, string> = {};
  const single = raw.metaVariables?.single ?? {};
  for (const [name, val] of Object.entries(single)) {
    if (val?.text != null) out[name] = val.text;
  }
  const multi = raw.metaVariables?.multi ?? {};
  for (const [name, val] of Object.entries(multi)) {
    const texts = (val?.multiple ?? []).map((m) => m.text ?? "").filter(Boolean);
    if (texts.length) out[`$$$${name}`] = texts.join(", ");
  }
  return out;
}

interface RunResult {
  matches: AstGrepMatch[];
  totalMatches: number;
  truncated: boolean;
  exitCode: number | null;
  stderr: string;
  parseErrors: number;
}

async function runAstGrep(
  args: string[],
  cap: number,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ast-grep", args, { stdio: ["ignore", "pipe", "pipe"] });
    const matches: AstGrepMatch[] = [];
    let totalMatches = 0;
    let truncated = false;
    let stdoutBuf = "";
    let stderrBuf = "";
    let parseErrors = 0;
    let settled = false;

    const timer = setTimeout(() => {
      truncated = true;
      stderrBuf += `\n[timed out after ${timeoutMs}ms]`;
      child.kill("SIGTERM");
    }, timeoutMs);

    const onParentAbort = () => {
      stderrBuf += `\n[cancelled: ${String(parentSignal?.reason ?? "aborted")}]`;
      child.kill("SIGTERM");
    };
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "ast-grep binary not found on PATH. Install with `pacman -S ast-grep` (Arch) or see https://ast-grep.github.io/guide/quick-start.html",
          ),
        );
      } else {
        reject(err);
      }
    });

    function consumeLine(line: string) {
      if (!line) return;
      let raw: RawMatch;
      try {
        raw = JSON.parse(line) as RawMatch;
      } catch {
        parseErrors++;
        return;
      }
      totalMatches++;
      if (matches.length >= cap) {
        truncated = true;
        return;
      }
      matches.push({
        file: raw.file ?? "<unknown>",
        startLine: (raw.range?.start?.line ?? 0) + 1,
        startColumn: (raw.range?.start?.column ?? 0) + 1,
        endLine: (raw.range?.end?.line ?? 0) + 1,
        endColumn: (raw.range?.end?.column ?? 0) + 1,
        snippet: snippetOf(raw.text ?? raw.lines ?? ""),
        metavars: extractMetavars(raw),
      });
    }

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        consumeLine(line);
      }
    });

    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuf += chunk;
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      if (stdoutBuf.trim()) consumeLine(stdoutBuf.trim());
      resolve({
        matches,
        totalMatches,
        truncated,
        exitCode: code,
        stderr: stderrBuf.trim(),
        parseErrors,
      });
    });
  });
}

function formatTextOutput(
  pattern: string,
  lang: string | null,
  path: string,
  result: RunResult,
  elapsedMs: number,
): string {
  const lines: string[] = [];
  const langPart = lang ? ` lang=${lang}` : "";
  lines.push(`ast-grep pattern=\`${pattern}\`${langPart} path=${path} (${elapsedMs}ms)`);

  if (result.exitCode !== 0 && result.matches.length === 0) {
    lines.push(`Exit code ${result.exitCode}.`);
    if (result.stderr) lines.push(result.stderr);
    return lines.join("\n");
  }

  if (result.totalMatches === 0) {
    lines.push("No matches.");
    if (result.stderr) lines.push(`stderr: ${result.stderr}`);
    return lines.join("\n");
  }

  const fileCount = new Set(result.matches.map((m) => m.file)).size;
  const shownLabel = result.truncated
    ? `${result.matches.length} of ${result.totalMatches}+ matches`
    : `${result.totalMatches} match${result.totalMatches === 1 ? "" : "es"}`;
  lines.push(`${shownLabel} in ${fileCount} file${fileCount === 1 ? "" : "s"}:`);
  lines.push("");

  for (const m of result.matches) {
    lines.push(`${m.file}:${m.startLine}:${m.startColumn}`);
    for (const sl of m.snippet.split("\n")) lines.push(`  ${sl}`);
    const mv = Object.entries(m.metavars);
    if (mv.length) {
      lines.push(`  metavars: ${mv.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
    }
    lines.push("");
  }

  if (result.truncated) {
    lines.push(`(truncated — raise max_matches to see more; total ≥ ${result.totalMatches})`);
  }
  if (result.parseErrors) {
    lines.push(`(${result.parseErrors} unparseable JSON line${result.parseErrors === 1 ? "" : "s"} skipped)`);
  }
  if (result.stderr) {
    lines.push(`stderr: ${result.stderr}`);
  }
  return lines.join("\n").trimEnd();
}

export default function astGrepExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ast-grep",
    label: "ast-grep",
    description:
      "Search code by tree-sitter AST pattern. Matches syntactic shape, not text. Use meta-variables ($NAME, $$$ARGS) to capture sub-expressions. Read-only — for rewrites use edit/write after locating matches.",
    promptSnippet:
      "Search code by AST pattern (`console.log($A)`, `function $NAME($$$){ $$$ }`) with structural matching across whitespace and formatting",
    promptGuidelines: [
      "Use ast-grep when you need structural matches grep would miss or false-positive: finding all call sites of a function regardless of indentation, locating every class declaration, capturing variable names via $NAME meta-variables.",
      "Patterns must be complete syntactic units in the target language — `function foo` is incomplete and won't match; `function foo($$$){ $$$ }` will. Pass `lang` explicitly when searching directories.",
      "Prefer plain `grep` for simple text or regex matches; ast-grep is slower and pickier about pattern shape.",
      "This tool is read-only. To rewrite matches, run ast-grep here first to find them, then use `edit` to change them — claude-mode gates write tools intentionally.",
    ],
    parameters: AstGrepParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        throw new Error(`Cancelled before run: ${String(signal.reason ?? "aborted")}`);
      }

      const pattern = params.pattern;
      const lang = params.lang ?? null;
      const path = params.path ?? ".";
      const cap = Math.min(
        Math.max(1, params.max_matches ?? DEFAULT_MAX_MATCHES),
        HARD_CAP_MATCHES,
      );
      const timeoutMs = Math.max(MIN_TIMEOUT_MS, params.timeout_ms ?? DEFAULT_TIMEOUT_MS);

      const args = ["run", "--json=stream", "--pattern", pattern];
      if (lang) args.push("--lang", lang);
      if (params.context != null && params.context > 0) {
        args.push("--context", String(params.context));
      }
      if (params.strictness) args.push("--strictness", params.strictness);
      for (const g of params.globs ?? []) args.push("--globs", g);
      args.push(path);

      const t0 = Date.now();
      const result = await runAstGrep(args, cap, timeoutMs, signal);
      const elapsedMs = Date.now() - t0;

      const text = formatTextOutput(pattern, lang, path, result, elapsedMs);
      const details: AstGrepDetails = {
        pattern,
        lang,
        path,
        matches: result.matches,
        totalMatches: result.totalMatches,
        truncated: result.truncated,
        elapsedMs,
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  });
}
