# Plan: Lightweight Offline Coding Harness (MacBook M1 Pro 32 GB + LM Studio + pi)

**Status:** PLANNED — not yet executed
**Written:** 2026-07-14 (research session; inventory + web research done, no changes made yet)
**Executor:** next agent — follow the steps in order; everything you need is in this file
**Machine:** MacBook Pro 16" (MacBookPro18,1), Apple M1 Pro, 32 GB unified memory, macOS 26.5.2
**Scope warning:** this plan is for the **MacBook** live config at `~/.pi/agent/`. The repo `README.md` and its VRAM tables are for the Linux desktop (RX 7900 XTX) — do NOT mix numbers between the two machines.

---

## 1. Goal

Turn the current over-stuffed pi install into the **lightest usable, Claude-Code-like coding harness** on a single machine, with LM Studio (MLX) as the inference backend, and set up a model that delivers good agentic-coding performance at large context **fully offline** (coding on a plane).

**Hard requirements (user-stated):**
1. Remove `pi-gitnexus` and resolve plugin conflicts.
2. Lightweight but near-Claude-Code workflow.
3. Fully offline usable (plane).
4. **Image paste into the pi prompt must work** (Claude-Code-style) — the primary model must be vision-capable and verified end-to-end (Step 6).

Guiding principle discovered during research: on a local model with 32–64 K context, **every registered tool schema and system-prompt injection costs context tokens the model needs for code**. UI-only extensions are free; tool-registering and prompt-injecting extensions must earn their keep.

---

## 2. Current-state inventory (verified 2026-07-14)

### 2.1 Live pi config (`~/.pi/agent/`)

- `settings.json`: `defaultProvider: lmstudio`, `defaultModel: gemma-4-12b-coder-fable5-composer2.5-nvfp4`, `PI_OFFLINE: true`, and 6 npm packages enabled (see 2.3).
- `models.json`: identical to repo `pi-config/models.json` (in sync). 3 providers: lmstudio (3 models), llamacpp (Odysseus llama-server, port 8000), ollama-cloud (placeholder API key, never filled).
- `extensions/`: 10 symlinks, all into this repo's `pi-config/extensions/` — live and repo are identical by construction.
- `skills/`: 2 symlinks into repo `pi-config/skills/` (`checkpoint-recovery-walkthrough`, `diagnose-tool-call-failure`).
- `APPEND_SYSTEM.md`: symlink → repo `pi-config/APPEND_SYSTEM.md.example`.
- Existing backups: `models.json.bak.20260516 / 20260622 / 20260706` — follow this naming pattern.

### 2.2 In-repo extensions (all currently symlinked live)

| Extension | What it does | Verdict |
|---|---|---|
| `claude-mode` | Confirmation gate on bash/write/edit + `/plan` (read-only), `/yolo`, `/ask`, trust cmds | **KEEP** — Claude Code plan-mode + permission-prompt analog; custom, known-good |
| `todo-tracker` | `todo` tool + `/todos` viewer | **KEEP** — TodoWrite analog |
| `question` | ask-user tool, no-op when non-interactive | **KEEP** — AskUserQuestion analog |
| `git-checkpoint` | commit before each turn; `/checkpoint`, `/restore` | **KEEP** — rewind analog |
| `dirty-repo-guard` | auto-commits dirty tree at start | **UNLINK** — overlaps git-checkpoint |
| `protected-paths` | blocks writes to protected patterns | **UNLINK** — claude-mode already gates write/edit |
| `session-memory` | per-project memory injected into system prompt | **UNLINK** — prompt-token cost every turn |
| `fetch` | HTTP fetch tool | **UNLINK** — dead weight offline; a failing tool wastes model turns |
| `ast-grep` | structural search tool | **UNLINK** — extra schema; needs external CLI; grep suffices for local models |
| `test` | test-runner tool (Go-style FAIL parsing) | **UNLINK** — bash covers it |

Unlinking = removing the symlink from `~/.pi/agent/extensions/`. Repo copies stay; re-link any time to restore.

### 2.3 npm packages — REMOVE ALL 6

| Package | Problem |
|---|---|
| `pi-gitnexus` v0.6.4 | **User-requested removal.** Hooks `tool_result` to shell out to external `gitnexus` CLI after every grep/find/bash/read (8 s timeout each); injects usage guidance into system prompt; registers 7 tools; spawns an MCP subprocess per session. |
| `@pi-archimedes/todo` | `/todos` command **collides** with in-repo todo-tracker (pi renames one to `/todos:1`); duplicate todo system (`manage_todo_list` tool). |
| `@tintinweb/pi-tasks` | Third task system (`/tasks`). Redundant. |
| `@tintinweb/pi-subagents` | Subagents on a single local model multiply token use and are slow on M1 Pro; impractical offline. |
| `pi-codex-goal` | Hooks a large set of runtime events every turn (`agent_start`, `turn_start/end`, `tool_execution_end`, `session_compact`, …). |
| `@plannotator/pi-extension` | Third `tool_call` blocker (blocks non-`.md` writes during its planning phase); conceptually overlaps claude-mode `/plan`. |

Conflicts these removals fix: the `/todos` name collision; 3 stacked `tool_call` blockers → 1; 5 parallel task/plan/goal systems → 1.

### 2.4 LM Studio (`~/.lmstudio/models/`, ~58 GB downloaded)

Relevant models present: `nightmedia/Qwen3.5-9B-TNG-PKD-Qwopus-Coder-Fable-Polaris-mxfp4-mlx` (5.3 G), `srv-sngh/gemma-4-12B-coder-fable5-composer2.5-nvfp4` (6.7 G), `Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16` (15 G), plus gemma-4 E2B/E4B, LFM2 models.
**NOT present anymore:** `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` (config JSON survives in `~/.lmstudio/.internal/user-concrete-model-default-config/`, weights were deleted). Note: official `qwen/qwen3.6-35b-a3b` MLX 4-bit is **20.43 GB** (user-verified in LM Studio). This model is now the second choice — see §3.2; the plane primary to download is **Devstral Small 2 24B** (vision required — see §1 hard requirements). **Downloads need internet — do them first.**

### 2.5 Repo branch state

`mlx-lmstudio-working` is 4 commits ahead of `main` (LM Studio migration, llamacpp provider, sync script) and contains a committed **2,232-line session-transcript `.txt`** that should not live in the repo.

---

## 3. Target design

### 3.1 Final harness (Claude-Code feature parity, minimum tokens)

| Claude Code feature | Provided by | Token cost |
|---|---|---|
| Plan mode + permission prompts | in-repo `claude-mode` | gate logic only |
| TodoWrite | in-repo `todo-tracker` | 1 tool |
| AskUserQuestion | in-repo `question` | 1 tool |
| Rewind / checkpoints | in-repo `git-checkpoint` | 0 tools (git-based) |
| CLAUDE.md / memory | pi-native `AGENTS.md` + `APPEND_SYSTEM.md` symlink | static prompt |
| Statusline w/ context % | **NEW: `pi-bar`** (npm v0.3.39, Jun 2026) — model, thinking level, color-coded context pressure | **zero** (UI-only, no tools, no prompt injection, zero deps) |
| Skills | existing 2 skill symlinks | lazy-loaded, ~0 |
| LSP (optional) | **`pi-diet-lsp`** (npm v0.1.6, Jun 2026) — on-demand `lsp_definition/references/symbols/hover/diagnostics`, no auto-injection, needs LSP servers on PATH, works offline | 5 tool schemas — install only if wanted |

Ecosystem research note (2026-07): surveyed the pi package catalog (awesome-pi.site, pi.dev/packages, earendil-works/pi discussion #3373). Nothing beats the custom `claude-mode` for the plan/permission core — community alternatives are heavier (`@plannotator`), cloud-model-dependent (`@dreki-gg/pi-plan-mode`), or Linux-only (`pi-landstrip`). `pi-bar` was the standout genuinely-free addition. Candidates deliberately skipped for this offline harness: all web-search/fetch packages, all subagent packages, context-compaction packages (`pi-hypa`, `pi-condense` — revisit only if context pressure proves problematic in practice).

### 3.2 Model lineup (offline)

> **Revised 2026-07-14, third pass — HARD REQUIREMENT added by user: image paste into the pi prompt (Claude-Code-style) is a MUST-HAVE.** The model must be vision-capable, its models.json entry must declare `"input": ["text", "image"]`, and image paste must be verified end-to-end in pi. This **disqualifies Qwen 4 Coder 32B-A3B from the primary slot** (text-only — the Qwen multimodal line is Qwen-VL, separate from Coder). Also user-verified sizes in LM Studio: `qwen/qwen3.6-35b-a3b` MLX 4-bit = **20.43 GB**; `qwen/qwen3.6-27b` MLX 4-bit = **16.08 GB**.

**Primary — Devstral Small 2 24B** (`mistralai/devstral-small-2-2512`, dense, Apache 2.0, 256 K ctx):
- **Vision support** (added in this generation) ✓ — satisfies the image-paste requirement natively.
- **68 % SWE-bench Verified**; purpose-built (with All Hands AI) to drive coding agents; MLX builds in LM Studio.
- ~13–15 GB at 4-bit ⇒ fits **under the default wired limit with ~6–8 GB spare for KV** — likely 64 K+ context with no sysctl changes (needs measurement).
- Non-thinking, Mistral ⇒ plain models.json entry (no Qwen flags), but **must include `"input": ["text", "image"]`**.
- Trade-off: dense 24 B ⇒ ~10–14 tok/s decode on M1 Pro vs 40–60 for MoEs. Acceptable given it wins every other axis under the vision constraint.
- Sources: aimadetools.com/blog/devstral-small-2-guide, huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512.

**Second — Qwen3.6-35B-A3B MLX 4-bit (20.43 GB official, user-verified)**: Vision ✓ (LM Studio capability badges), higher bench than Devstral (**73.4 % SWE-V**), fast MoE decode — but 20.43 GB exceeds the default ~21.3 GB wired limit at ANY useful context, so it always needs the sysctl bump + Q8 KV (20.43 + ~3.1 GB Q8 KV @ 64 K ≈ 23.6 GB under a 26 GB limit), and it's a thinking model (reasoning tokens cost context + time; REQUIRES both `"reasoning": true` and `"compat": { "thinkingFormat": "qwen" }` plus `"input": ["text", "image"]`). Choose it over Devstral if measured Devstral speed proves unacceptable.

**Excluded from primary (text-only) — Qwen 4 Coder 32B-A3B** (2026-06-02; MoE 3 B active, Apache 2.0, 256 K ctx): best-in-class agentic coder (**82 % SWE-bench Verified**, ~58 tok/s on a 24 GB Mac, non-thinking) but **no image input**, which fails the must-have. Two ways to still use it, both optional:
  1. Register it as a text-only *speed* model alongside the vision primary and switch per-task (`/model`).
  2. Ecosystem escape hatch: `pi-vision-handoff` / `pi-vision-tool` npm extensions describe a pasted image with a small vision model and hand text to a text-only model — adds an extension + a second loaded model (~3–4 GB, e.g. a 4B VL) and is lossy; contradicts the lightweight goal, so only pursue if Qwen 4 Coder's coding lead proves irresistible in practice.
  - Sources: llmcheck.net/blog/qwen-4-coder-review, insiderllm.com/guides/qwen-models-guide.

**Considered and rejected — Gemma 4 26B-A4B QAT (15 GB MLX, config JSON already present locally)**: attractive footprint (QAT 4-bit, A4B MoE, fits default wired limit with ~6 GB KV spare) but **52.0 % SWE-bench Verified** vs Devstral's 68 % at the same size and Qwen 4 Coder's 82 %. It ties Qwen on single-shot LiveCodeBench (80.0 vs 80.4) yet drops ~21–30 pts on the agentic benchmark that mirrors pi's tool-loop workload — it loses coherence across multi-step repo work. Fine as a chat/explanation model; wrong pick for driving an agent.

**Fallback fast — `qwen3.5-9b-tng-pkd-qwopus-coder-fable-polaris-mlx`**: already downloaded and registered, ctx 131072, 5.3 GB, **vision ✓** (entry already declares text+image) — use when the big model feels slow or for huge-context sessions. LiveCodeBench 65.6, but 9B-class agentic ability is a tier below Devstral — sprint model, not the cross-file-refactor model.

**Slow-but-smart alternate — `qwen/qwen3.6-27b`** (16.08 GB official 4-bit, user-verified; already registered at ctx 34000, a 15 GB variant already downloaded): Vision ✓, higher single-shot code quality than the 3.6 MoE, but dense **and** thinking ⇒ ~11–13 tok/s with reasoning tokens first — minutes per agentic turn. Keep registered for careful one-shot work; not the plane driver.

- Memory budget (M1 Pro 32 GB): macOS default GPU-wired limit ≈ 21.3 GB; raiseable via `sudo sysctl iogpu.wired_limit_mb=26624` (resets on reboot — re-run after restart, e.g. morning of the flight). MoE KV ≈ ~96 KB/token fp16 (≈ 3.1 GB @ 32 K, 6.3 GB @ 64 K); enable **KV Cache Quantization: Q8** in LM Studio load params to halve it. Prefill speed (not memory) may be the practical ceiling — a ~40 K prompt takes on the order of a minute to prefill on M1 Pro. Vision note: image tokens also consume context (a screenshot ≈ hundreds–low-thousands of tokens) — budget for it when sizing.

**Keep registered (alternate): `srv-sngh` Gemma-4-12B coder** — current default; demote from default but leave the entry.

**Prune from live models.json:** `ollama-cloud` provider (placeholder key, useless offline) and `llamacpp` provider (points at Odysseus llama-server `localhost:8000` — that's the desktop flow, not this Mac). They remain in git history / desktop config if ever needed.

### 3.3 New models.json entry (template — verify id before committing)

```json
{
  "id": "<EXACT id from GET /v1/models after loading — likely mistralai/devstral-small-2-2512>",
  "name": "Devstral Small 2 24B (vision, plane primary)",
  "contextWindow": 32768,
  "input": ["text", "image"]
}
```

Devstral is **non-thinking** — no `reasoning` or `compat.thinkingFormat` fields. `"input": ["text", "image"]` is REQUIRED for pi to accept pasted images with this model. Only Qwen3.6-family entries need `"reasoning": true` + `"compat": { "thinkingFormat": "qwen" }`.

Hard-won rules that apply (from prior sessions, verified against pi source at the time):
1. **Both** `"reasoning": true` **and** `"compat": { "thinkingFormat": "qwen" }` are required for Qwen3.6-family thinking mode — either alone is silently inert. Verify with `pi --list-models` → thinking column. (Not applicable to Qwen 4 Coder / Devstral — non-thinking.)
2. No `supportsDeveloperRole: false` needed — LM Studio's `:1234` server normalizes `developer` → `system` (that flag is only for raw `mlx_lm.server` backends).
3. `contextWindow` **must** be set and must equal LM Studio's Context Length for the model — pi's default is 128000, so omitting it disables pi auto-compaction and LM Studio silently truncates.
4. "Offload KV Cache to GPU" stays **ON** in LM Studio (turning it off saves nothing, just slows inference).

---

## 4. Execution steps (in order)

### Step 0 — Preconditions
- [ ] Internet available (model download + npm installs). If flight is imminent, do Step 4 (download) FIRST.
- [ ] `cp ~/.pi/agent/models.json ~/.pi/agent/models.json.bak.$(date +%Y%m%d)`
- [ ] `cp ~/.pi/agent/settings.json ~/.pi/agent/settings.json.bak.$(date +%Y%m%d)`

### Step 1 — Remove all 6 npm packages
```
pi remove npm:pi-gitnexus
pi remove npm:@pi-archimedes/todo
pi remove npm:@tintinweb/pi-tasks
pi remove npm:@tintinweb/pi-subagents
pi remove npm:pi-codex-goal
pi remove npm:@plannotator/pi-extension
```
(or edit `packages: []` in `~/.pi/agent/settings.json` and clean `~/.pi/agent/npm/node_modules/`).
Gitnexus leftovers: `npm ls -g gitnexus` → uninstall global CLI if present; `rm -f ~/.pi/pi-gitnexus.json` if it exists.

### Step 2 — Trim in-repo extension symlinks
```
cd ~/.pi/agent/extensions
rm dirty-repo-guard protected-paths session-memory fetch ast-grep test
```
Remaining: `claude-mode`, `git-checkpoint`, `question`, `todo-tracker`. Keep both skills symlinks.

### Step 3 — Install pi-bar (+ optional pi-diet-lsp)
```
pi install npm:pi-bar
# optional: pi install npm:pi-diet-lsp   (only if LSP tools wanted; needs language servers on PATH)
```

### Step 4 — Download the plane model (INTERNET REQUIRED)
In LM Studio: search **Devstral Small 2** (`mistralai/devstral-small-2-2512`), MLX 4-bit (~13–15 GB — confirm exact size and the **Vision capability badge** in the download dialog before downloading).
Optional extras if disk allows (nothing can be downloaded mid-flight): **Qwen 4 Coder 32B-A3B** MLX 4-bit as a text-only speed model (check size; ≥ ~20 GB ⇒ sysctl mandatory for it).
Load params: Context Length **32768**, Offload KV Cache to GPU **ON**, **KV Cache Quantization: Q8** (halves KV memory; needed to reach 64 K later). Load fully once (first load warms caches).

### Step 5 — Update live models.json + settings.json
- Get the exact served id: `curl -s http://localhost:1234/v1/models | jq -r '.data[].id'`
- Add the entry from §3.3 with that id under the `lmstudio` provider.
- Delete the `ollama-cloud` and `llamacpp` provider blocks.
- In `settings.json`: set `defaultModel` to the new id.
- Verify: `pi --list-models` → new model listed (thinking column `no` is correct for Devstral / Qwen 4 Coder; input column should show image support for Devstral).

### Step 6 — Online smoke test
Run pi on a real small project: plan-mode → approve → multi-file edit → `/checkpoint` → `/restore` round-trip. Confirm: no `/todos:1`-style command renames in startup output; pi-bar footer shows model + context pressure; no gitnexus subprocess noise.
**Image-paste test (MUST-HAVE):** copy a screenshot to the clipboard, paste it into the pi prompt, and confirm the model describes/uses it. If paste doesn't reach the model, check in order: (a) the entry declares `"input": ["text", "image"]`; (b) LM Studio loaded the vision variant (capability badge); (c) pi's TUI paste handling in the current pi version (upstream docs/changelog) — resolve before flying.

### Step 7 — OFFLINE dry-run (the actual point)
1. Wi-Fi **off**.
2. Launch LM Studio, load the primary model, launch pi.
3. Do a genuine coding task (edit-run-fix loop) for 15–30 min.
4. Watch: pi-bar context pressure; Activity Monitor memory pressure (must stay out of red / no swap storms); note tok/s feel.

### Step 8 — Measure and raise context stepwise
32768 → 49152 → 65536: at each step change **both** LM Studio Context Length and models.json `contextWindow`, fill context with a long session, record in §6 table. For the 65536 step, first raise the GPU wired limit: `sudo sysctl iogpu.wired_limit_mb=26624` (re-run after every reboot — do it before boarding). Stop at the last stable value (≥ ~3 GB free memory at full context). Also note prefill time on a full-context turn — if turn-start latency is unacceptable, prefer the lower context tier even if memory fits. Per repo rules: **only measured numbers go into docs unflagged** — anything projected must say "needs measurement".

### Step 9 — Sync the repo
- Mirror final live `models.json` → `pi-config/models.json`.
- Update `README.md` "External packages" section (the 6 documented npm packages are removed; now `pi-bar` [+ `pi-diet-lsp` if installed]).
- Add Mac-specific documentation (new `docs/macbook-m1pro.md` or a clearly-scoped README section) with the measured table from §6. Do **not** insert Mac numbers into the desktop VRAM tables.
- Bump `**Last updated:**` in README with reason.

### Step 10 — Branch hygiene
- On `mlx-lmstudio-working`: `git rm` the committed session-transcript `.txt` (2,232 lines, root of repo), commit.
- Merge or PR `mlx-lmstudio-working` → `main`.

---

## 5. Verification checklist (definition of done)

- [ ] `pi --list-models`: primary model present
- [ ] `curl -s localhost:1234/v1/models | jq` id exactly matches models.json id
- [ ] `~/.pi/agent/settings.json` packages = `["npm:pi-bar"]` (± pi-diet-lsp); defaultModel = primary model id
- [ ] `~/.pi/agent/extensions/` contains exactly: claude-mode, git-checkpoint, question, todo-tracker
- [ ] No command-name collisions in pi startup output
- [ ] **Image paste into pi prompt works with the primary model (offline)** — screenshot → clipboard → paste → model responds to image content
- [ ] Wi-Fi-off session: full plan → edit → checkpoint → restore cycle completed
- [ ] Context raised to highest **measured-stable** value; models.json + LM Studio agree
- [ ] Repo synced (models.json template, README packages section, Mac doc, Last-updated bump)
- [ ] Transcript file removed from branch; branch merged to main

## 6. Measured results (fill in during Step 7/8)

| Model | LM Studio ctx | Loaded mem (GB) | Free mem at full ctx (GB) | tok/s decode | Prefill feel | Image paste OK? | Stable? |
|---|---|---|---|---|---|---|---|
| Devstral Small 2 24B MLX 4bit | 32768 | | | | | | |
| Devstral Small 2 24B MLX 4bit | 49152 | | | | | | |
| Devstral Small 2 24B MLX 4bit | 65536 | | | | | | |
| Qwen 4 Coder 32B-A3B MLX 4bit (optional, text-only) | 49152 | | | | | n/a | |
| Qwen3.5-9B coder (fallback) | 131072 | | | | | | |

## 7. Rollback

- models.json / settings.json: restore from the Step-0 `.bak.YYYYMMDD` copies.
- Extensions: re-create symlinks from `pi-config/extensions/<name>` — nothing was deleted from the repo.
- npm packages: `pi install npm:<name>` reinstalls any of the six.
