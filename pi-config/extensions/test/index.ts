/**
 * test: project test-runner tool for pi.
 *
 * Registers a `test` tool the LLM can call to run the project's test
 * suite without parsing arbitrary bash output. Auto-detects the
 * runner from filesystem markers:
 *
 *   - pytest        — pytest.ini, pyproject.toml, setup.cfg, conftest.py
 *   - vitest / jest — package.json devDependencies
 *   - cargo test    — Cargo.toml
 *   - go test       — go.mod
 *
 * Returns exit code, captured output (capped), duration, and a list of
 * parsed `{file, line, message}` failures lifted from the runner's
 * output. For unsupported projects fall back to `bash`.
 *
 * Why this exists:
 *   - Each runner has its own stdout format; parsing it through `bash`
 *     mid-loop is brittle, especially on local models
 *   - One uniform interface lets the model reason about "did tests
 *     pass" and "what broke" without language-switching
 *
 * Pairs with claude-mode: in ASK_TOOLS only. Deliberately NOT in
 * PLAN_TOOLS — running a test suite executes user code and is not
 * "read-only exploration". Not gated by claude-mode's confirmation
 * (no file writes by the tool itself), and the surface deliberately
 * excludes a free-form `command` parameter so the model can't smuggle
 * arbitrary shell through it — for custom commands use `bash`.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_MS = 300_000; // 5 min
const MAX_TIMEOUT_MS = 1_800_000; // 30 min hard cap
const MIN_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PARSED_FAILURES = 50;

const Runner = StringEnum(["pytest", "jest", "vitest", "cargo", "go"] as const);
type RunnerName = "pytest" | "jest" | "vitest" | "cargo" | "go";

const TestParams = Type.Object({
  runner: Type.Optional(Runner),
  filter: Type.Optional(
    Type.String({
      description:
        "Narrow to tests whose name matches the filter (passes -k / -t / --testNamePattern / -run depending on runner)",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "Directory to run tests from (used for both detection and as the subprocess cwd). Default: current working directory.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: `Kill the test process after this many milliseconds (default ${DEFAULT_TIMEOUT_MS}, minimum ${MIN_TIMEOUT_MS}, hard cap ${MAX_TIMEOUT_MS})`,
    }),
  ),
});

interface ParsedFailure {
  file: string;
  line: number | null;
  message: string;
}

interface TestDetails {
  runner: RunnerName | null;
  command: string[];
  cwd: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
  bytesCaptured: number;
  parsedFailures: ParsedFailure[];
}

function detectRunner(cwd: string): RunnerName | null {
  if (
    existsSync(join(cwd, "pytest.ini")) ||
    existsSync(join(cwd, "conftest.py")) ||
    existsSync(join(cwd, "setup.cfg"))
  ) {
    return "pytest";
  }
  if (existsSync(join(cwd, "pyproject.toml"))) {
    try {
      const content = readFileSync(join(cwd, "pyproject.toml"), "utf8");
      if (/\[tool\.pytest|pytest/.test(content)) return "pytest";
    } catch {
      // Unreadable; fall through.
    }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) return "cargo";
  if (existsSync(join(cwd, "go.mod"))) return "go";
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (allDeps.vitest) return "vitest";
      if (allDeps.jest) return "jest";
    } catch {
      // Malformed package.json — give up on JS detection.
    }
  }
  return null;
}

function buildCommand(runner: RunnerName, filter: string | undefined): string[] {
  switch (runner) {
    case "pytest":
      return filter ? ["pytest", "-k", filter] : ["pytest"];
    case "jest":
      return filter
        ? ["npx", "--no-install", "jest", "--testNamePattern", filter]
        : ["npx", "--no-install", "jest"];
    case "vitest":
      return filter
        ? ["npx", "--no-install", "vitest", "run", "-t", filter]
        : ["npx", "--no-install", "vitest", "run"];
    case "cargo":
      return filter ? ["cargo", "test", filter] : ["cargo", "test"];
    case "go":
      return filter ? ["go", "test", "-run", filter, "./..."] : ["go", "test", "./..."];
  }
}

function parseFailures(runner: RunnerName, output: string): ParsedFailure[] {
  const failures: ParsedFailure[] = [];

  if (runner === "pytest") {
    // "FAILED tests/test_foo.py::test_bar - assert 1 == 2"
    // "ERROR tests/test_foo.py::test_baz - ImportError: ..."
    const re = /^(?:FAILED|ERROR)\s+(\S+?)(?:::(\S+?))?(?:\s+-\s+(.+))?$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      failures.push({
        file: m[1],
        line: null,
        message: m[3] ?? m[2] ?? "failed",
      });
      if (failures.length >= MAX_PARSED_FAILURES) break;
    }
    return failures;
  }

  if (runner === "jest" || runner === "vitest") {
    // jest:   "FAIL src/foo.test.ts"
    // vitest: " FAIL  src/foo.test.ts > suite > test name"
    const re = /^\s*(?:FAIL|×)\s+(\S+\.(?:tsx?|jsx?|mjs|cjs|svelte|vue))(?:\s+>\s+(.+?))?$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      failures.push({
        file: m[1],
        line: null,
        message: m[2] ?? "test file failed",
      });
      if (failures.length >= MAX_PARSED_FAILURES) break;
    }
    return failures;
  }

  if (runner === "cargo") {
    // "thread 'foo::bar' panicked at src/lib.rs:42:5:\n  message"
    const re =
      /thread '([^']+)' panicked at ([^:]+):(\d+)(?::\d+)?:\s*\n?\s*(.+?)(?=\n\n|\nthread |\ntest result:|$)/gs;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      failures.push({
        file: m[2],
        line: Number.parseInt(m[3], 10),
        message: `${m[1]}: ${m[4].trim().split("\n")[0]}`,
      });
      if (failures.length >= MAX_PARSED_FAILURES) break;
    }
    return failures;
  }

  if (runner === "go") {
    // "--- FAIL: TestFoo (0.00s)" then "    foo_test.go:42: error message"
    const blockRe = /^--- FAIL: (\S+).*?\n((?:^\s+[^\n]+\n)+)/gm;
    let bm: RegExpExecArray | null;
    while ((bm = blockRe.exec(output)) !== null) {
      const testName = bm[1];
      const body = bm[2];
      const locRe = /^\s+(\S+\.go):(\d+):\s*(.+)$/gm;
      let lm: RegExpExecArray | null;
      while ((lm = locRe.exec(body)) !== null) {
        failures.push({
          file: lm[1],
          line: Number.parseInt(lm[2], 10),
          message: `${testName}: ${lm[3]}`,
        });
        if (failures.length >= MAX_PARSED_FAILURES) break;
      }
      if (failures.length >= MAX_PARSED_FAILURES) break;
    }
    return failures;
  }

  return failures;
}

interface RunResult {
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  bytesCaptured: number;
}

async function runTestProcess(
  command: string[],
  cwd: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<RunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });

    let captured = "";
    let bytesCaptured = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const append = (chunk: string) => {
      bytesCaptured += Buffer.byteLength(chunk, "utf8");
      const remaining = MAX_OUTPUT_BYTES - captured.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length <= remaining) {
        captured += chunk;
      } else {
        captured += chunk.slice(0, remaining);
        truncated = true;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000);
    }, timeoutMs);

    const onParentAbort = () => {
      child.kill("SIGTERM");
    };
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        rejectRun(
          new Error(
            `Test runner binary '${bin}' not found on PATH. Install it for this project (e.g. \`pip install pytest\`, \`npm i\`, or \`pacman -S go rust\`), or run a different test command via bash.`,
          ),
        );
      } else {
        rejectRun(err);
      }
    });

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => append(chunk));
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => append(chunk));

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
      resolveRun({
        exitCode: timedOut ? null : code,
        output: captured,
        truncated,
        timedOut,
        bytesCaptured,
      });
    });
  });
}

function formatTextOutput(details: TestDetails, output: string): string {
  const lines: string[] = [];
  const status = details.timedOut
    ? "TIMED OUT"
    : details.passed
      ? "PASS"
      : "FAIL";
  const runnerLabel = details.runner ?? "(none)";
  lines.push(
    `${status} runner=${runnerLabel} exit=${details.exitCode ?? "killed"} duration=${details.durationMs}ms cwd=${details.cwd}`,
  );
  lines.push(`command: ${details.command.join(" ")}`);

  if (details.parsedFailures.length) {
    lines.push("");
    lines.push(`parsed failures (${details.parsedFailures.length}):`);
    for (const f of details.parsedFailures) {
      const loc = f.line == null ? f.file : `${f.file}:${f.line}`;
      lines.push(`  ${loc} — ${f.message}`);
    }
  }

  if (output.trim()) {
    lines.push("");
    lines.push("--- output ---");
    lines.push(output);
    if (details.outputTruncated) {
      lines.push(
        `--- output truncated at ${MAX_OUTPUT_BYTES} bytes; total ${details.bytesCaptured} bytes ---`,
      );
    }
  }

  if (details.timedOut) {
    lines.push("");
    lines.push("(test process killed by timeout — raise timeout_ms or narrow with filter)");
  }

  return lines.join("\n");
}

export default function testExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "test",
    label: "Run tests",
    description:
      "Run the project's test suite. Auto-detects pytest, jest, vitest, cargo, or go from filesystem markers (pytest.ini / Cargo.toml / go.mod / package.json devDependencies). Returns exit code, captured output, and parsed failures with file:line where the runner provides them.",
    promptSnippet:
      "Run project tests (pytest/jest/vitest/cargo/go) and get exit code + parsed failures",
    promptGuidelines: [
      "Use the `test` tool instead of running pytest/jest/cargo/go through `bash` — the structured output (exit code, parsed failures) is easier to act on than parsing raw text.",
      "Detection looks for pytest.ini / conftest.py / setup.cfg / pyproject.toml ([tool.pytest...]) / Cargo.toml / go.mod / package.json devDependencies. If detection misfires pass `runner` explicitly.",
      "`filter` narrows to a single test by name (passes -k / -t / --testNamePattern / -run depending on runner).",
      "For projects not matching a supported runner (e.g. mocha, unittest, custom shell test scripts), use `bash` directly instead of forcing this tool.",
    ],
    parameters: TestParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const cwd = resolve(params.path ?? process.cwd());
      const runner = params.runner ?? detectRunner(cwd);
      if (!runner) {
        return {
          content: [
            {
              type: "text",
              text:
                `No supported test runner detected in ${cwd}.\n` +
                `Looked for: pytest.ini, conftest.py, setup.cfg, pyproject.toml (with [tool.pytest...]), Cargo.toml, go.mod, package.json with jest/vitest in devDependencies.\n` +
                `Pass \`runner\` explicitly, or use \`bash\` for a custom test command.`,
            },
          ],
          details: {
            runner: null,
            command: [],
            cwd,
            exitCode: null,
            passed: false,
            durationMs: 0,
            timedOut: false,
            outputTruncated: false,
            bytesCaptured: 0,
            parsedFailures: [],
          } as TestDetails,
        };
      }

      const command = buildCommand(runner, params.filter);
      const timeoutMs = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(MIN_TIMEOUT_MS, params.timeout_ms ?? DEFAULT_TIMEOUT_MS),
      );

      const t0 = Date.now();
      const run = await runTestProcess(command, cwd, timeoutMs, signal);
      const durationMs = Date.now() - t0;

      const parsedFailures = parseFailures(runner, run.output);
      const passed = !run.timedOut && run.exitCode === 0;

      const details: TestDetails = {
        runner,
        command,
        cwd,
        exitCode: run.exitCode,
        passed,
        durationMs,
        timedOut: run.timedOut,
        outputTruncated: run.truncated,
        bytesCaptured: run.bytesCaptured,
        parsedFailures,
      };

      return {
        content: [{ type: "text", text: formatTextOutput(details, run.output) }],
        details,
      };
    },
  });
}
