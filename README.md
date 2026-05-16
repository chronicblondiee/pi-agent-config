# Local LLM + pi.dev setup reference

Personal reference for running [pi.dev](https://pi.dev/) (Mario Zechner's terminal coding agent harness) against local models served by LM Studio on this workstation.

**Last updated:** 2026-05-16 — added a **Mac alternative — mlx_lm.server on M1 Pro 32 GB** section between the CachyOS LM Studio load params and the pi.dev integration block. Later same day: ported the `mlx-server` wrapper to portable bash at [`scripts/mlx-server.sh`](./scripts/mlx-server.sh) (lifted out of `pi-config/scripts/` to the repo root since it's a runtime helper, not pi-agent configuration — identical behavior to the fish version, targets stock macOS `bash 3.2`, no associative arrays, honors `MLX_SERVER_{VENV,STATE_DIR,HOST,PORT}` env overrides) and reformatted the install snippets in the Mac section from fish to bash so they work on systems without fish; later same day: aligned the `mlx-local` provider entry in `pi-config/models.json` (and the matching README example) so its `id` is `Qwen3.6-27B-MTPLX-Optimized-Speed` — the directory basename that `mlx_lm.server` reports when the wrapper's default model is loaded — so out-of-the-box `mlx-server start` + default `models.json` route correctly without manual editing (still verify with `curl -s http://localhost:8080/v1/models | jq` after first load). Background: LM Studio's bundled MLX runtime (`app-mlx-generate-mac14-arm64@25`, ships `mlx_vlm 0.4.5`) doesn't yet recognize Qwen3.6's MTP architecture — loads fail with `Received N parameters not in model: mtp.*`. The new section documents a `uv`-managed env running public `mlx-lm` 0.31.3 + `mlx_lm.server` as a parallel OpenAI-compatible endpoint on `localhost:8080`, with an `mlx-local` provider added to `pi-config/models.json` alongside (not replacing) the existing CachyOS `lmstudio` entry. All Mac throughput/VRAM/context numbers are intentionally left as **needs measurement** per the CLAUDE.md "don't generalize from 7900 XTX" guardrail — pending first real load on M1 Pro 32 GB. MTPLX is flagged as a future option but currently unusable (requires ≥48 GiB unified memory). Same day: added [`pi-config/scripts/mlx-server.fish`](./pi-config/scripts/mlx-server.fish), a `start|stop|restart|status|log|list` wrapper around `mlx_lm.server` with a small hardcoded model registry (defaults to `qwen3.6-27b` → `~/.lmstudio/models/Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed`); installs via symlink into `~/.local/bin/mlx-server`, state under `~/.local/state/mlx-server/`. Also noted that LM Studio's existing MLX downloads can be reused as-is by pointing `--model` at the `~/.lmstudio/models/<pub>/<name>/` path — no duplication needed — and that the Youssofal MTPLX directory works under plain `mlx-lm` because the MTP weights live in an unindexed `mtp.safetensors` that the standard loader silently skips (so a working Qwen3.6 27B is already on disk without re-downloading).

Previous: 2026-05-14 — added a `question` extension (vendored from the upstream pi example) that registers a `question` tool letting the agent pause mid-turn for user input — ↑/↓ to navigate supplied options, Enter to pick, or pick "Type something." for a free-form answer, Esc cancels; headless `pi -p` returns an error result instead of blocking. Added to both `ASK_TOOLS` and `PLAN_TOOLS` (UI only, no side effects); later same day: added an `ast-grep` extension that wraps the [ast-grep](https://ast-grep.github.io/) CLI as an LLM-callable tool for structural (tree-sitter AST) code search with meta-variable captures (`$NAME`, `$$$ARGS`), `--json=stream` parsing, default 200-match cap (hard cap 1000), 30 s timeout, and `--rewrite` deliberately not exposed (use `edit`/`write` to keep claude-mode's gate in the loop). Added to both `ASK_TOOLS` and `PLAN_TOOLS` (read-only); later same day: dropped the stale `@juicesharp/rpiv-ask-user-question` package section — the in-repo `question` extension supersedes it and the package is not installed; later same day: added a `test` extension that registers a `test` tool wrapping the project's test runner. Auto-detects pytest / vitest / jest / cargo / go from filesystem markers and returns structured output (exit code, parsed `{file, line, message}` failures, duration, captured stdout/stderr capped at 256 KB). Supports `filter`, `path`, `timeout_ms` (default 5 min, hard cap 30 min); deliberately no free-form `command` parameter — use `bash` for non-standard test commands. Added to `ASK_TOOLS` only (not `PLAN_TOOLS` — plan mode is read-only exploration); later same day: added a `session-memory` extension that closes the "pi sessions are amnesic" gap with `remember` / `forget` tools backed by per-project JSON at `~/.pi/agent/memory/<slug>.json`. Entries are injected into the system prompt every turn via `before_agent_start`, so they survive compaction and new sessions from the same cwd. Tools added to both `ASK_TOOLS` and `PLAN_TOOLS` (writes go into `~/.pi/agent/memory/`, never the project itself). Slash commands `/memory`, `/memory-clear`, `/remember <text>` round out the user-facing surface; later same day: added a **Git workflow** section to APPEND_SYSTEM.md encoding the branch-per-change → `gh pr create` → `gh pr merge --merge --delete-branch` flow so pi.dev sessions follow it without re-learning each time. Live file synced from `pi-config/APPEND_SYSTEM.md.example` with `.bak.2026-05-14` of the prior version kept alongside.

Previous: 2026-05-13 — added four new extensions (`git-checkpoint`, `protected-paths`, `todo-tracker`, `dirty-repo-guard`) and the `@juicesharp/rpiv-ask-user-question` package for mid-loop user questions; later same day: `/checkpoint-off`/`/checkpoint-on` for git-checkpoint, `.pi/protected-paths.json` per-project config for protected-paths, staged/unstaged split + "checkpoint then proceed" option in dirty-repo-guard, `/trust-tool`/`/untrust-tool` for claude-mode, two starter skills (`diagnose-tool-call-failure`, `checkpoint-recovery-walkthrough`) under `pi-config/skills/`, enabled `reasoning` + `qwen-chat-template` thinking format on both Gemma 4 entries in `models.json` (verified against Gemma 4 26B A4B: pi sends `chat_template_kwargs.enable_thinking: true`; Gemma emits a `<|channel>thought ... <channel|>` block; pi's qwen-chat-template handler strips it cleanly from visible output. Current-turn only — prior-turn thinking is still stripped by LM Studio per the 2026-05-10 note), synced the live append-style system prompt into the repo template (now `pi-config/APPEND_SYSTEM.md.example`, renamed from `SYSTEM.md.example`), and propagated the Gemma `reasoning`/`compat` fields into the README's `models.json` template block to match the live config, and added an **Error recovery** section to APPEND_SYSTEM.md (diagnose-before-retry, 2-retry cap, path verification, no sudo, simplify on JSON parse failure, abandon hung commands); later same day: added a `fetch` extension that registers an LLM-callable HTTP/HTTPS tool (GET/POST/PUT/PATCH/DELETE/HEAD with custom headers, request body, default 256 KB response cap, hard 4 MB cap, 30 s timeout) so pi can read documentation pages, hit local services, and pull raw GitHub files without shelling out through bash + curl — added to `claude-mode` `ASK_TOOLS` so it survives a `/plan` → `/ask` toggle, deliberately excluded from `PLAN_TOOLS` (plan mode is local exploration only)

Previous: 2026-05-10 — added `reasoning: true` and `compat: { thinkingFormat: "qwen" }` to both Qwen3.6 entries; pi requires both fields for thinking mode to actually fire over the OpenAI-compat (LM Studio) transport, otherwise `enable_thinking` is never sent in the request body and the model stays in non-thinking mode regardless of MLX/GGUF capability

Previous: 2026-05-09 — added `claude-mode` extension (confirmation gate + `/plan` / `/yolo` / `/ask` / `/trust` slash commands), APPEND_SYSTEM.md guidance, corrected `input` arrays (all four models support Vision in LM Studio), and added `contextWindow` per model so pi auto-compacts at the real loaded context instead of pi's 128K default

---

## TL;DR — which model when

| Use case | Model | Why |
|---|---|---|
| **Default agent driver** | Qwen3.6 27B (dense) | Top agentic benchmarks in this lineup; SWE-Bench 77.2%, Terminal-Bench 59.3% |
| Speed-mode iteration | Gemma 4 26B A4B (MoE) | ~3× tok/s of dense Qwen 27B; trades reliability for speed |
| Experimental hybrid | Qwen3.6 35B A3B (MoE) | Qwen quality + MoE speed; tighter VRAM budget |
| Long-context refactor | Qwen3.6 27B at 64k ctx | Quality holds up at long context; KV is not pathologically heavy |
| General Q&A / chat | Gemma 4 31B (dense) | Solid generalist; not recommended for agent loops |

Hardware profile is captured in `~/.claude/projects/-home-brown-projects/memory/hardware_workstation.md` — short version: Ryzen 9800X3D, RX 7900 XTX 24 GB, 64 GB DDR5, CachyOS.

---

## Model comparison

All four models tested at Q4_K_M quantization (GGUF, llama.cpp via LM Studio).

| Model | Type | Total params | Active | Q4_K_M size | SWE-Bench V. | Terminal-Bench 2.0 | HumanEval | LiveCodeBench |
|---|---|---|---|---|---|---|---|---|
| **Qwen3.6 27B** | dense | 27B | 27B | 16.28 GB | **77.2%** | **59.3%** | — | — |
| **Qwen3.6 35B A3B** | MoE | 35B | 3B | 20.55 GB | 73.4% | 51.5% | — | — |
| **Gemma 4 26B A4B** | MoE | 26B | ~3.8B | 16.76 GB | — | — | 78.5% | — |
| **Gemma 4 31B** | dense | 31B | 31B | 18.52 GB | ~64% | — | 82.7%–88% | 80% |

### Notes on the numbers

- **Qwen3.6 27B** released 2026-04-22 — Alibaba's flagship dense agentic model. SWE-Bench Verified (77.2%) lands within 3.7 points of Claude Opus 4.6 (80.8%); Terminal-Bench 2.0 (59.3%) matches Claude 4.5 Opus exactly.
- **Qwen3.6 35B A3B** released 2026-04-16 — sparse MoE, 3B active per token. Outperforms many 100B+ dense models on agentic tasks despite the small active footprint.
- **Gemma 4 26B A4B** — MoE with ~3.8B active. Google reports HumanEval 78.5% and Codeforces rating 2150. **No published Terminal-Bench or SWE-Bench numbers** — Gemma 4 is positioned as a generalist, not an agentic-coding specialist.
- **Gemma 4 31B** — dense, strong on math/MMLU but middling on agentic benchmarks. Roughly 64% SWE-Bench Verified — well behind Qwen3.6 27B on the same task.

**Bottom line for agentic coding on this hardware:** Qwen models dominate the benchmarks that matter for pi.dev (Terminal-Bench, SWE-Bench). Gemma is the speed/chat option.

---

## LM Studio load params

### Universal baseline (every model)

Toggle **Show advanced settings** in the load dialog, then:

| Setting | Value |
|---|---|
| GPU Offload | **Max** (drag slider all the way right) |
| Flash Attention | **ON** |
| K Cache Quantization Type | **Q8_0** |
| V Cache Quantization Type | **Q8_0** |
| CPU Thread Pool Size | **8** (matches 9800X3D physical cores) |
| Evaluation Batch Size | 512 |
| Max Concurrent Predictions | 4 |
| Unified KV Cache | ON |
| Offload KV Cache to GPU Memory | **ON** (do not disable — see note below) |
| Keep Model in Memory | ON |
| Try mmap() | ON (irrelevant when fully GPU-offloaded) |
| RoPE Frequency Base / Scale | Auto |
| Seed | Random |

Then check **"Remember settings for `<model-id>`"** so the dialog skips next time.

> **Why "Offload KV Cache to GPU = ON" always:** the KV cache exists either way — its size is set by context length. Disabling offload moves it to system RAM, which kills inference speed (PCIe round-trips per token per layer). It does **not** "save context" — it just makes the same context dramatically slower. Real ways to reduce KV memory: shorter context, Q8/Q4 KV quant, Flash Attention.

### Per-model deltas

#### Qwen3.6 27B (dense)

| Setting | Value |
|---|---|
| Context Length | **65536** (recommended) — **32768** confirmed safe |
| GPU Offload | Max (64 layers) |

**Confirmed estimator readings on 7900 XTX 24 GB:**

| Context | Estimated GPU usage | Headroom to 24 GB |
|---|---|---|
| 32768 | 19.58 GB | ~4.4 GB |
| 65536 | ~22.9 GB (projected from KV scaling) | ~1.1 GB — tight but fits |

KV scales linearly with context, so doubling 32k → 64k adds ~3.3 GB. If the estimator at 65k lands above 23 GB at load time, back off to 49152 (~21.2 GB) to leave runtime allocation buffer.

No MoE settings (dense model — no experts row in dialog).

#### Qwen3.6 35B A3B (MoE)

| Setting | Value |
|---|---|
| Context Length | **24576** (confirmed) |
| GPU Offload | Max (40 layers) |
| Number of Experts | **leave at model default** (do not lower) |
| Number of layers for which to force MoE weights onto CPU | **0** initially; bump to **8–16** if it OOMs |

**Confirmed estimator reading on 7900 XTX 24 GB:** at 24576 context with full offload, Flash Attention + K/V Q8_0 → **21.90 GB GPU / 21.90 GB Total**. ~2.1 GB headroom.

Pushing past 24k risks OOM since weights are already 20.55 GB. If you must go higher, raise "Force MoE weights to CPU" to 8–16 first — cold experts spill to system RAM (60 GB available), hot ones stay on GPU. Speed cost ~5–10%.

#### Gemma 4 26B A4B (MoE)

| Setting | Value |
|---|---|
| Context Length | **65536** (the most context-friendly of the four) |
| GPU Offload | **Max** — drag slider all the way right (≈30 layers); partial offload kills MoE speed |
| Number of Experts | **8** (model default — do NOT change) |
| Number of layers for which to force MoE weights onto CPU | 0 |

**Confirmed estimator reading on 7900 XTX 24 GB:** at 65536 context with full offload → **~20 GB GPU / ~20 GB Total**. ~4 GB headroom — most relaxed of the four.

> **Watch for partial offload trap:** if the dialog shows GPU < Total (e.g. 18.69 GB / 20.02 GB), some layers are on CPU. Drag GPU Offload slider fully right until GPU and Total match — every PCIe round-trip per token undoes the MoE speed advantage.

The "Number of Experts" field is the model's native expert count for routing. Lowering it forcibly disables experts and breaks output quality.

#### Gemma 4 31B (dense)

| Setting | Value |
|---|---|
| Context Length | **24576 max** (KV cache is unusually heavy on this model) |
| GPU Offload | Max (typically 60 layers) |

**Confirmed estimator reading on 7900 XTX 24 GB:** at 24576 context with full offload + Flash Attention + K/V Q8_0 → **23.91 GB GPU / 23.91 GB Total**. Razor-thin — only ~0.1 GB headroom, no room for runtime drift.

> **Do not exceed 24576 context on this model.** At 32k it lands at or beyond the 24 GB cap with desktop compositor competing for VRAM. If you need >24k, switch to Qwen3.6 27B.

Of the four, this one is closest to the VRAM ceiling. Watch for ROCm OOM mid-generation; if it happens, drop context to 20480.

---

## Mac alternative — mlx_lm.server on M1 Pro 32 GB

> **CachyOS workstation users — skip this section.** Everything above and below stays unchanged on the 7900 XTX setup. This section only applies when running pi against a Mac.

### Why this exists

LM Studio's bundled MLX runtime (`~/.lmstudio/extensions/backends/vendor/_amphibian/app-mlx-generate-mac14-arm64@25/`, ships `mlx_vlm 0.4.5`) doesn't yet recognize Qwen3.6's MTP layers. Loading any Qwen3.6 MLX build through LM Studio currently fails with:

```
ValueError: Received 29 parameters not in model:
mtp.fc.weight, mtp.layers.0.input_layernorm.weight, ...
```

The wrapper version `mlx-llm-...-1.8.1` shipped 2026-05-16 still pins to the same `@25` vendor lib, so this is fixed only by a future `@26`-style vendor bump. Until then, the Mac path runs the public `mlx-lm` directly under a `uv`-managed env and serves it via `mlx_lm.server`, then points pi at the new endpoint as a second OpenAI-compatible provider.

### Hardware profile

Apple M1 Pro, 32 GB unified memory, macOS 14+. **All numbers in this section are _needs measurement_ — do not extrapolate from the 7900 XTX tables above.**

### Build a uv-managed env

`uv` is the standard Python toolchain on macOS; this keeps the runtime separate from system Python and trivially reproducible.

```bash
# One-time install
brew install uv

# Create the env (project-local; lives outside this repo)
uv venv ~/projects/mac-mlx-env --python 3.11

# Install mlx-lm directly into that env (no shell-activation needed) — 0.31.3+
# has Qwen3.5 architecture support; Qwen3.6 mostly loads via overlap (the MTP
# heads are silently ignored, which is fine — no speculative decoding, just
# standard autoregressive decode)
uv pip install --python ~/projects/mac-mlx-env/bin/python -U mlx-lm
```

If you want an interactive activation instead, use the shell-specific entry point:

```bash
# bash / zsh
source ~/projects/mac-mlx-env/bin/activate
```

```fish
# fish
source ~/projects/mac-mlx-env/bin/activate.fish
```

### Launch the server via the wrapper script

Two equivalent wrappers ship in this repo, identical in behavior — pick the one for your shell:

- [`scripts/mlx-server.sh`](./scripts/mlx-server.sh) — portable bash (targets the stock `bash 3.2` on macOS; works on any POSIX-ish shell that can exec bash).
- [`pi-config/scripts/mlx-server.fish`](./pi-config/scripts/mlx-server.fish) — fish-native equivalent.

Both bundle `start`/`stop`/`restart`/`status`/`log`/`list` subcommands so the server can be brought up without remembering the full `mlx_lm.server` invocation. Install one of them via symlink:

```bash
mkdir -p ~/.local/bin

# bash / zsh users (default — recommended for portability)
ln -sf ~/projects/pi-agent-config/scripts/mlx-server.sh ~/.local/bin/mlx-server

# fish users (alternative)
# ln -sf ~/projects/pi-agent-config/pi-config/scripts/mlx-server.fish ~/.local/bin/mlx-server

# ensure ~/.local/bin is on PATH (bash/zsh):
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
  export PATH="$HOME/.local/bin:$PATH"
;; esac
```

Fish users can use `fish_add_path -U ~/.local/bin` instead of the `case` block above.

Daily use:

```bash
mlx-server start                  # default model (qwen3.6-27b — Youssofal MTPLX dir)
mlx-server start qwen3.5-9b       # switch to the smaller registered model
mlx-server start /path/to/model   # ad-hoc, any MLX safetensors dir
mlx-server status                 # is it running and bound to :8080?
mlx-server log                    # tail server log (Ctrl-C to exit)
mlx-server stop
mlx-server restart qwen3.6-27b
mlx-server list                   # show configured models, marks default
```

State is kept in `~/.local/state/mlx-server/` (pidfile + log). The script backgrounds the server with `disown`, so it survives the terminal that launched it. Defaults: `127.0.0.1:8080`, model registry hardcoded in the script — edit the `_resolve_model` case statement (bash) or `MODELS` map (fish) to register new entries. The bash version also honors `MLX_SERVER_VENV`, `MLX_SERVER_STATE_DIR`, `MLX_SERVER_HOST`, and `MLX_SERVER_PORT` env overrides.

Under the hood it runs:

```bash
$VENV/bin/mlx_lm.server --model <resolved-path> --host 127.0.0.1 --port 8080
```

For the raw command (debugging or one-offs), call that directly with the venv activated.

After the server is listening, verify the id pi will see:

```bash
curl -s http://localhost:8080/v1/models | jq
```

That id is what must appear in `models.json` — `mlx_lm.server` typically reports the model directory's basename (e.g. `Qwen3.6-27B-MTPLX-Optimized-Speed`) or the HF repo id, depending on how it was loaded. Correct the `mlx-local` provider entry if the reported id doesn't match.

### Model picks for 32 GB unified memory

| Model | Size on disk | Fits 32 GB? | Notes |
|---|---|---|---|
| `mlx-community/Qwen3.6-35B-A3B-4bit` | ~22 GB | ✅ recommended | MoE 3B active; parallels the CachyOS A3B entry but without MTP speculative decoding |
| `unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit` | ~22 GB | ✅ alternative | Unsloth Dynamic quant; better quality at same bits, but watch for arch-detection issues in mlx-lm |
| `unsloth/Qwen3.6-27B-UD-MLX-4bit` | ~26 GB | ⚠ tight | Dense; leaves ~4 GB for KV cache + OS, will likely swap on long contexts |
| `unsloth/Qwen3.6-27B-MLX-8bit` | ~28 GB | ❌ skip | No usable headroom |

### MTPLX — future option, currently unusable

[MTPLX](https://github.com/youssofal/MTPLX) is a native MTP-aware MLX runtime claiming ~2.24× decode TPS on Qwen3.6 27B by actually executing the MTP heads as a built-in speculative decoder. It also exposes an OpenAI-compatible server, so it would slot into the same `mlx-local` provider shape.

**Cannot be used on this M1 Pro 32 GB** — MTPLX requires a minimum of **48 GiB unified memory** (warns below that floor; refuses to run above 80% utilization). Revisit when/if the host machine is upgraded.

### Measurements pending

| Quantity | Value | How to measure |
|---|---|---|
| Wall RAM at idle (model loaded, no context) | _needs measurement_ | `vm_stat` + Activity Monitor after server is listening |
| Max usable context length | _needs measurement_ | Start at 16384, send increasing-length prompts until throughput collapses |
| Decode tok/s @ 4096 ctx | _needs measurement_ | `mlx_lm.server` returns timing in `usage.timings` if `--log-level info`; otherwise wall-clock a fixed-length completion |
| Decode tok/s @ 32768 ctx | _needs measurement_ | same |
| Pi auto-compaction threshold | follows `contextWindow` in models.json (currently 16384) | bump after first measurement run |

When real numbers are in hand, replace this table and bump `contextWindow` in `pi-config/models.json` accordingly.

### Pi usage notes

- Switch to the Mac provider with `/model` and pick the `mlx-local` entry.
- `input` is restricted to `["text"]` — vision goes through `mlx_vlm` which is the broken path. If you need image input on Mac, use the Linux LM Studio entries.
- `mlx_lm.server` doesn't currently support a `--draft-model` flag for speculative decoding, so the speed parity with the CachyOS workstation's LM Studio entry won't be achieved here until MTPLX (or LM Studio's `@26` vendor lib) lands.

---

## pi.dev integration

### Install reminder

Pi is `@earendil-works/pi-coding-agent` on npm. Repo: <https://github.com/badlogic/pi-mono>. Default tools: `read`, `write`, `edit`, `bash`. Multi-provider via OpenAI / Anthropic / Google / OpenAI-compatible.

### Config file paths

| Path | Scope |
|---|---|
| `~/.pi/agent/models.json` | Global provider + model registration |
| `~/.pi/agent/settings.json` | Global settings |
| `~/.pi/agent/SYSTEM.md` | Global system prompt override |
| `.pi/settings.json` | Project-local override (cwd) |
| `.pi/SYSTEM.md` | Project-local system prompt |

### `models.json` template

A copy-paste ready version is in [`pi-config/models.json`](./pi-config/models.json). Key shape:

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        { "id": "qwen/qwen3.6-27b",          "input": ["text", "image"], "contextWindow": 65536, "reasoning": true, "compat": { "thinkingFormat": "qwen" } },
        { "id": "qwen/qwen3.6-35b-a3b",      "input": ["text", "image"], "contextWindow": 24576, "reasoning": true, "compat": { "thinkingFormat": "qwen" } },
        { "id": "google/gemma-4-26b-a4b",    "input": ["text", "image"], "contextWindow": 65536, "reasoning": true, "compat": { "thinkingFormat": "qwen-chat-template" } },
        { "id": "google/gemma-4-31b",        "input": ["text", "image"], "contextWindow": 24576, "reasoning": true, "compat": { "thinkingFormat": "qwen-chat-template" } }
      ]
    },
    "mlx-local": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "mlx-local",
      "models": [
        { "id": "Qwen3.6-27B-MTPLX-Optimized-Speed", "input": ["text"], "contextWindow": 16384, "reasoning": true, "compat": { "thinkingFormat": "qwen" } }
      ]
    }
  }
}
```

The `id` strings must match the model id the server reports at `GET /v1/models` — verify with `curl -s http://localhost:1234/v1/models | jq` (LM Studio, CachyOS) or `curl -s http://localhost:8080/v1/models | jq` (mlx_lm.server, Mac) after loading a model. See **Mac alternative — mlx_lm.server on M1 Pro 32 GB** for setting up the second endpoint.

`contextWindow` must match the **Context Length** you set in LM Studio's load dialog for that model (see "Per-model deltas" below). Pi defaults to 128000 if omitted, which means auto-compaction won't fire until well past the model's actual loaded context — and LM Studio will silently truncate the prompt instead. If you change a model's context in LM Studio, change it here too. Verify with `pi --list-models`.

### Switching models inside pi

- `/model` slash command in the REPL, or
- `Ctrl+L` keyboard shortcut

### LM Studio server prerequisites

In LM Studio:

1. **Developer tab → Start Server** (default port 1234)
2. **Just-in-Time model loading: ON** if you want pi to switch models on demand; **OFF** if pinning one model
3. **Verbose logging: ON** while debugging tool-call format issues
4. **CORS:** only matters for browser clients; pi runs in terminal so leave it off

### Sampling params for tool reliability

Pi doesn't expose per-model sampling defaults in `models.json` — values flow through from the request, or fall back to LM Studio's per-model Inference defaults. Set these as the LM Studio defaults for each loaded model:

| Param | Value | Notes |
|---|---|---|
| Temperature | **0.1–0.2** | Drop to 0.0 if you see malformed JSON tool calls in a loop |
| Top-P | 0.9 | |
| Top-K | 20 | |
| Min-P | 0.05 | Bump to 0.1 if 0.0 temperature still produces broken JSON |
| Repeat Penalty | 1.05 | Higher hurts code quality |

### System prompt scaffold

Drop a tighter system prompt at `~/.pi/agent/SYSTEM.md` (replaces pi's built-in) or `~/.pi/agent/APPEND_SYSTEM.md` (appends to it) to reinforce tool-call discipline — append example at [`pi-config/APPEND_SYSTEM.md.example`](./pi-config/APPEND_SYSTEM.md.example) (mirrors the file actually in use here; tightens tool-call discipline, references claude-mode's `/yolo` and `/plan` interactions, and adds a plan-then-execute rule). The append variant is safer; full replace makes you responsible for the tool-use instructions pi normally provides. Especially helpful for Gemma models, which are slightly less reliable on tool-call JSON than Qwen.

### claude-mode extension (confirmation gate + plan mode)

Pi has no built-in permission system or plan mode — both are deliberate non-features. The [`pi-config/extensions/claude-mode/`](./pi-config/extensions/claude-mode/) extension adds them:

- **Gate:** before `bash`, `write`, or `edit` runs, prompts `Yes / No / Always for this session`.
- **`/plan`** — read-only mode. Active tools restricted to `read, grep, find, ls`.
- **`/yolo`** — disable the gate for the rest of the session (asks for one confirmation).
- **`/ask`** — restore default gated behavior, clears any "always" memory.
- **`/trust`** — print current mode and remembered allow-list.
- **`/trust-tool <name>`** — pre-allow a single gated tool (`bash`, `edit`, or `write`) for the session without going through a prompt. `/untrust-tool <name>` revokes it.
- Footer shows `[ask]` / `[plan]` / `[yolo]`. State resets every session.

Install (one-time symlink so edits in this repo take effect live):

```fish
mkdir -p ~/.pi/agent/extensions
ln -s ~/projects/pi-agent-config/pi-config/extensions/claude-mode ~/.pi/agent/extensions/claude-mode
```

Pi auto-discovers `~/.pi/agent/extensions/*/index.ts` — no settings.json entry needed. See [`pi-config/extensions/claude-mode/README.md`](./pi-config/extensions/claude-mode/README.md) for design notes and known limits.

### Additional extensions

Six more extensions ship alongside claude-mode. All are in [`pi-config/extensions/`](./pi-config/extensions/) and use the same symlink pattern.

| Extension | What it does | Commands |
|---|---|---|
| **git-checkpoint** | Commits before each agent turn; offers restore on `/fork`. Note: rewrites your working-tree commits while pi runs — incompatible with `git add -p` workflows. Use `/checkpoint-off` to pause without unloading. | `/checkpoint`, `/checkpoints`, `/restore <sha>`, `/checkpoint-off`, `/checkpoint-on` |
| **protected-paths** | Blocks writes to `.env*`, `.git/`, `node_modules/`, `.ssh/`, etc. (even in `/yolo` mode). Per-project extensions via `.pi/protected-paths.json` (see below) | `/trust-paths`, `/unprotect <path>` |
| **todo-tracker** | `todo` tool for the LLM to manage a task list; status widget shows `done/total` | `/todos` |
| **dirty-repo-guard** | Warns before session exit/switch/fork if working tree has uncommitted changes (no-op in `-p` / headless mode). Reports staged vs unstaged separately. Prompt offers "Checkpoint then proceed" to commit on the fly. | `/dirty` |
| **fetch** | `fetch` tool for HTTP/HTTPS GET/POST/PUT/PATCH/DELETE/HEAD with custom headers, request body, response cap (default 256 KB, hard cap 4 MB), and 30 s timeout. Used by the LLM directly instead of shelling out through bash + curl. http/https only; file:// is rejected. Added to `claude-mode` `ASK_TOOLS` so it survives `/plan` → `/ask`; intentionally excluded from `PLAN_TOOLS`. | _(no slash commands)_ |
| **question** | `question` tool that pauses the agent mid-turn for user input. Full custom TUI: ↑/↓ to navigate supplied options, Enter to pick, or pick "Type something." for a free-form answer. Esc cancels. Headless `pi -p` returns an error result instead of blocking. Vendored from the upstream pi example. Added to both `ASK_TOOLS` and `PLAN_TOOLS` — UI only, no side effects. | _(no slash commands)_ |
| **ast-grep** | `ast-grep` tool wrapping the [ast-grep](https://ast-grep.github.io/) CLI for structural (tree-sitter AST) code search. Patterns capture meta-variables (`$NAME`, `$$$ARGS`); supports `lang`, `path`, `globs`, `context`, `strictness`, `max_matches` (default 200, hard cap 1000), 30 s timeout. Read-only — `--rewrite` deliberately not exposed (use `edit`/`write` so claude-mode's gate fires). Requires `ast-grep` on PATH (`pacman -S ast-grep`). Added to both `ASK_TOOLS` and `PLAN_TOOLS`. | _(no slash commands)_ |
| **test** | `test` tool that runs the project's test suite and returns structured output (exit code, parsed failures with file:line, duration, captured stdout/stderr capped at 256 KB). Auto-detects pytest / vitest / jest / cargo / go from filesystem markers (pytest.ini, conftest.py, setup.cfg, pyproject.toml `[tool.pytest...]`, Cargo.toml, go.mod, package.json devDependencies); pass `runner` explicitly to override. Supports `filter` (passes -k / -t / --testNamePattern / -run), `path`, `timeout_ms` (default 5 min, hard cap 30 min). Deliberately no free-form `command` parameter — use `bash` for non-standard test commands. Added to `ASK_TOOLS` only (not `PLAN_TOOLS` — plan mode is read-only exploration, running tests executes user code). | _(no slash commands)_ |
| **session-memory** | `remember` / `forget` tools backed by per-project JSON at `~/.pi/agent/memory/<slug>.json` (slug derived from cwd). Entries are injected into the system prompt every turn via `before_agent_start`, so they survive compaction and new sessions started from the same cwd. Up to 50 most-recent entries shown; bodies capped at 2 000 chars. Both tools added to `ASK_TOOLS` and `PLAN_TOOLS` (writes only into `~/.pi/agent/memory/`, never the project). | `/memory`, `/memory-clear`, `/remember <text>` |

Install all eight:

```fish
for ext in git-checkpoint protected-paths todo-tracker dirty-repo-guard fetch question ast-grep test session-memory;
  ln -sf ~/projects/pi-agent-config/pi-config/extensions/$ext ~/.pi/agent/extensions/$ext;
end
```

#### Per-project protected paths

Drop a `.pi/protected-paths.json` in the project root to extend (or replace) the defaults — handy for protecting a specific build dir or local secrets file that the global defaults wouldn't catch.

```json
{
  "replace": false,
  "patterns": [
    { "kind": "dir",      "name": "dist" },
    { "kind": "exact",    "name": "credentials.json" },
    { "kind": "subpath",  "path": "config/local.toml" },
    { "kind": "dotPrefix","name": ".secrets" }
  ]
}
```

Pattern kinds:
- `dir` — match any path segment by name (e.g. `dist/`, `node_modules/`).
- `exact` — match the basename exactly.
- `dotPrefix` — match the basename, or the basename + `.<anything>` (e.g. `.env` covers `.env.local`).
- `subpath` — match the full or trailing path.

Set `"replace": true` to drop the built-in defaults entirely. Invalid entries are silently dropped; `/trust-paths` prints the active set and source.

### Skills

Pi auto-discovers [Agent Skills](https://agentskills.io/specification) from `~/.pi/agent/skills/<name>/SKILL.md`. Each skill exposes a `/skill:<name>` command, and the description is included in the system prompt so the model can decide when to load the full instructions.

In-repo skills live at [`pi-config/skills/<name>/`](./pi-config/skills/) and are symlinked into the live location, same pattern as extensions:

| Skill | What it covers |
|---|---|
| **diagnose-tool-call-failure** | Triage for malformed tool calls — wrong JSON, narration instead of calls, runaway output. Walks through chat template, APPEND_SYSTEM.md, models.json shape, context overflow, and falling back to Qwen. |
| **checkpoint-recovery-walkthrough** | The git-checkpoint recovery flow: `/checkpoints` → pick SHA → `/restore` → verify, plus the cross-session fallback via `git log --grep="\[pi-checkpoint\]"`. |

```fish
mkdir -p ~/.pi/agent/skills
for skill in diagnose-tool-call-failure checkpoint-recovery-walkthrough;
  ln -sfn ~/projects/pi-agent-config/pi-config/skills/$skill ~/.pi/agent/skills/$skill;
end
```

---

## Decision tree

```
What are you doing?
│
├── Multi-step agent loop (refactor, multi-file edit, debug)
│   └── Qwen3.6 27B dense @ 65k context (confirmed ~22.9 GB)
│       (highest agentic benchmarks; accept slower tok/s for fewer wasted turns)
│
├── Quick chat / one-shot edit / autocomplete-style task
│   └── Gemma 4 26B A4B @ 65k context (confirmed ~20 GB)
│       (fastest; quality good enough for non-critical work)
│
├── Long-context refactor (large repo, lots of file context)
│   └── Qwen3.6 27B dense @ 65k context — same as default
│       (no separate config needed; default already at max useful context)
│
└── Want to test the experimental option
    └── Qwen3.6 35B A3B @ 24576 context (confirmed 21.90 GB)
        (MoE speed + Qwen quality; tight VRAM)
```

---

## Why active params matter (and tok/s alone doesn't)

Agentic loops are **decision-heavy, not generation-heavy**. The wall-clock time to finish a task is `turns_to_completion × seconds_per_turn`, and turn count dominates when the model thrashes (wrong file picked, malformed tool call, retry). Rough thresholds for active params:

| Active params | Behavior |
|---|---|
| < 3B | Unreliable for tool calling; frequent thrashing |
| 3–4B | Workable for simple tasks; struggles on multi-file edits |
| 7–14B | Reliable for most agentic work |
| 20B+ active or 27B+ dense | Near-frontier reliability (Qwen3.6 27B is here) |

This is why Qwen3.6 27B at 26 tok/s often beats Gemma 4 26B A4B at 75 tok/s for actual agent work, despite the latter being 3× faster per token. **Benchmark on a real task** before committing.

---

## Tuning levers if you need more performance

In rough order of impact:

1. **Confirm ROCm runtime** in LM Studio Settings → Hardware. Vulkan works but ROCm is typically +20–30% on RDNA3.
2. **Speculative decoding** — load a small Qwen 1.5B or 3B as draft model. 1.5–2× speedup on code, zero quality loss. Check whether your LM Studio version exposes it.
3. **Prompt caching** — keep stable prefixes (system prompt, repo context) at the start of every request. LM Studio reuses KV across turns when prefix matches. Can cut turn time 50–70% in long sessions.
4. **K/V cache Q4_0** instead of Q8_0 — small speed bump, small quality cost. Test on your workload before committing.
5. **Lower context** — KV is scanned every token. 64k → 16k can shave several tok/s on long sessions.

---

## Where LM Studio persists per-model settings

Once "Remember settings for `<model-id>`" is checked, LM Studio writes to:

```
~/.lmstudio/.internal/user-concrete-model-default-config/<model-id>.json
```

You can edit those files directly, but every advanced setting is exposed in the GUI — there's no real reason to. See [`lmstudio-presets/README.md`](./lmstudio-presets/README.md) for the file format and a backup reminder.

---

## References

### Qwen
- [Qwen3.6-27B blog](https://qwen.ai/blog?id=qwen3.6-27b)
- [Qwen3.6-35B-A3B blog](https://qwen.ai/blog?id=qwen3.6-35b-a3b)
- [Qwen3.6-27B HF model card](https://huggingface.co/Qwen/Qwen3.6-27B)
- [Qwen3.6-35B-A3B HF model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)
- [QwenLM/Qwen3.6 GitHub](https://github.com/QwenLM/Qwen3.6)
- [MarkTechPost: Qwen3.6-27B beats 397B on agentic coding (2026-04-22)](https://www.marktechpost.com/2026/04/22/alibaba-qwen-team-releases-qwen3-6-27b-a-dense-open-weight-model-outperforming-397b-moe-on-agentic-coding-benchmarks/)

### Gemma
- [Gemma 4 official launch (Google)](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Gemma 4 benchmark blog](https://gemma4-ai.com/blog/gemma4-benchmark)
- [Gemma 4 26B A4B HF](https://huggingface.co/google/gemma-4-26B-A4B-it)
- [Gemma 4 31B HF](https://huggingface.co/google/gemma-4-31B)
- [Google DeepMind: Gemma 4](https://deepmind.google/models/gemma/gemma-4/)

### Comparison sources
- [BenchLM: Qwen3.6-27B vs 35B-A3B](https://benchlm.ai/compare/qwen3-6-27b-vs-qwen3-6-35b-a3b)
- [BenchLM: Gemma 4 31B](https://benchlm.ai/models/gemma-4-31b)

### Pi
- [pi.dev landing page](https://pi.dev/)
- [pi-mono GitHub](https://github.com/badlogic/pi-mono)
- [pi-coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [Patrick Loeber: running Pi with Gemma 4 + LM Studio](https://patloeber.com/gemma-4-pi-agent/)
- [Mario Zechner: building pi](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
