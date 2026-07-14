# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this repo is

A personal **reference + config-template repo** — not a software project. There is no build, no tests, no lint, no package manager. Edits are almost always to Markdown documentation or to JSON/Markdown templates that the user copies into live config locations elsewhere on the system.

## Layout and source-of-truth

- `README.md` — the canonical document. Everything else exists to support it.
- `pi-config/` — templates and extensions for the pi.dev coding agent.
  - `models.json`, `SYSTEM.md.example` — reference copies; live versions at `~/.pi/agent/`.
  - `extensions/claude-mode/` — actual TypeScript source for the confirmation-gate + plan-mode extension. **Symlinked** into `~/.pi/agent/extensions/claude-mode` so edits here take effect live (different pattern from the copy-based templates above; this is real code under development, not a one-off config).
- `lmstudio-presets/` — placeholder for LM Studio per-model preset snapshots. The **live** presets live at `~/.lmstudio/.internal/user-concrete-model-default-config/<model-id>.json`. The repo's `lmstudio-presets/README.md` documents the backup recipe; actual snapshots are not currently checked in.
- `scripts/` — portable runtime helpers (not pi-agent configuration). Currently holds `setup-mac-mlx-env.sh` and `pi-mlx-local.sh` for the Mac `mlx-openai-server` provider. Install `pi-mlx-local.sh` via symlink into `~/.local/bin/pi-mlx-local`.

When the user asks to "update the config," clarify whether they mean the template in this repo, the live config under `~/.pi/` or `~/.lmstudio/`, or both.

## Hardware assumptions baked into every recommendation

All VRAM tables, context-length caps, and offload settings in `README.md` are specific to **RX 7900 XTX 24 GB + Ryzen 9800X3D + 64 GB DDR5 on CachyOS**. Numbers are not portable to other GPUs. Do not generalize them or invent new ones — the README's estimator readings are **measured**, and unmeasured projections are explicitly flagged as such (e.g., "projected from KV scaling"). If asked to add a new model or context size, prefer "needs measurement" over a guess.

## Editing the README

- The `**Last updated:**` line near the top should be bumped (with the reason) when substantive content changes. Today's date format: `YYYY-MM-DD`.
- The "TL;DR — which model when," "Model comparison," "LM Studio load params," and "Decision tree" sections must stay consistent — a change to a model's recommended context in one place should propagate to all of them.
- Benchmark numbers (SWE-Bench, Terminal-Bench, HumanEval, LiveCodeBench) are sourced from the links in the **References** section. Don't introduce new numbers without a corresponding reference.

## pi.dev / LM Studio integration facts worth keeping in mind

- pi connects to LM Studio's OpenAI-compatible server at `http://localhost:1234/v1` (`apiKey: "lm-studio"`).
- Model `id` strings in `pi-config/models.json` must match what LM Studio reports at `GET /v1/models` — verify with `curl -s http://localhost:1234/v1/models | jq` after loading.
- Each model entry needs an explicit `contextWindow` matching the LM Studio Context Length for that model. Pi's default is 128000 — far above any locally-loaded model — so omitting it means pi auto-compaction never fires before LM Studio silently truncates. The README's "Per-model deltas" table is the source of truth for these values; if you change a model's context in LM Studio, mirror it in `models.json`.
- "Offload KV Cache to GPU" should always be ON — disabling it does not save context, it just slows inference. The README has a callout explaining why; preserve that framing if you touch the section.

## Pi extensions (claude-mode)

- Extensions are TypeScript files loaded by pi via jiti — no build step. Auto-discovered at `~/.pi/agent/extensions/*.ts` or `~/.pi/agent/extensions/*/index.ts`.
- The main in-repo mode extension is `pi-config/extensions/claude-mode/index.ts`. Pi API surface used: `pi.on("tool_call", handler)` (return `{ block, reason }` or `undefined`), `pi.registerCommand(name, { description, handler })`, `pi.registerTool(...)`, `pi.setActiveTools([...])`, `ctx.ui.select/confirm/notify/setStatus`, `ctx.ui.theme.fg(role, str)`, `ctx.hasUI`. Source-of-truth API docs: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`.
- Built-in tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. The extension's `ASK_TOOLS` and `PLAN_TOOLS` constants must stay aligned with whatever pi's actual built-ins are if pi adds more.
- There is an upstream `plan-mode` example in pi-mono. Loading both will collide on the `/plan` command name (pi will rename one to `/plan:1`). Don't recommend installing the upstream example alongside `claude-mode`.
- Pi explicitly does NOT support: declarative permission config, hooks-as-config, MCP servers, subagents. If the user asks for any of those, the answer is "build an extension" — don't promise config-only solutions.
