# Local LLM + pi.dev setup reference

Personal reference for running [pi.dev](https://pi.dev/) (Mario Zechner's terminal coding agent harness) against local models served by LM Studio on this workstation.

**Last updated:** 2026-07-18 — ran a real ceiling test on the Mac `mlx-local` Qwen3.6 27B setup (48017 tokens, no real safety margin), then raised `contextWindow` 30720 → 32768 based on interpolation between two real measured points (comfortable at 30017, tight at 48017); see [Change notes](#change-notes) for full history including the 2026-07-17 Devstral→Qwen3.6-27B model switch.

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

LM Studio's bundled MLX runtime (`~/.lmstudio/extensions/backends/vendor/_amphibian/app-mlx-generate-mac14-arm64@25/`, ships `mlx_vlm 0.4.5`) doesn't yet recognize Qwen3.6's MTP layers, so the Mac path has never used LM Studio for local coding models — it runs a `uv`-managed MLX server env and points pi at that endpoint as a second OpenAI-compatible provider.

The server layer switched from [`mlx-openai-server`](https://pypi.org/project/mlx-openai-server/) to `mlx_lm.server` (bundled with `mlx-lm` itself) on 2026-07-17. The trigger was evaluating Devstral Small 2 24B as a primary-model candidate: `mlx-openai-server`'s own batch-scheduler thread doesn't register an MLX GPU stream, which crashes on Devstral's sliding-window attention cache —

```
RuntimeError: There is no Stream(gpu, 1) in current thread.
```

— reproducing across `mlx-openai-server` 1.8.1 and 1.6.3, and persisting even with an unreleased upstream `mlx-lm` fix (see `ml-explore/mlx-lm#1181`, `#1256`), which narrows it to a bug in `mlx-openai-server`'s own code, not just an outdated dependency pin.

Devstral itself was superseded the same day by `mlx-community/Qwen3.6-27B-4bit` after a head-to-head test showed near-identical size and speed but a much stronger published SWE-Bench score (see [Model picks](#model-picks-for-32-gb-unified-memory)) — and Qwen3.6-27B has MTP layers (`mtp_num_hidden_layers: 1` in its config), not a sliding-window cache, so it likely never hit the `mlx-openai-server` bug in the first place. `mlx_lm.server` was kept anyway: it already worked cleanly through two full model swaps and has a simpler flag surface, and there was no concrete reason to switch back. Trade-off either way: `mlx_lm.server` has no `--context-length` or `--kv-bits` flags, so there is no hard server-side context cap and no KV-cache quantization; see [Current Pi context status](#current-pi-context-status) for the measured-safe ceiling this relies on instead.

### Hardware profile

Apple M1 Pro, 32 GB unified memory, macOS 14+. **Only the explicitly marked Pi-visible context numbers below are measured for this host — do not extrapolate from the 7900 XTX tables above.**

### Build a uv-managed env

`uv` is the standard Python toolchain on macOS; this keeps the runtime separate from system Python and trivially reproducible. Use Python 3.12 for v1. Do not baseline Python 3.14 yet; test it later only in a throwaway env after `mlx-lm` and its dependencies explicitly support it.

```bash
# One-time install
brew install uv

# Create the env (project-local; lives outside this repo)
uv venv ~/projects/mac-mlx-env --python 3.12

# mlx-lm is pinned to a specific unreleased commit until the Stream(gpu, N) fix ships
# in a release; see "Why this exists" above.
uv pip install --python ~/projects/mac-mlx-env/bin/python \
  "mlx>=0.32.0" \
  "git+https://github.com/ml-explore/mlx-lm.git@15b522f593b7ca5fbc0cac6f7572d40859d2d8fe" \
  hf_transfer
```

The same setup is captured in [`scripts/setup-mac-mlx-env.sh`](./scripts/setup-mac-mlx-env.sh). It defaults to `~/projects/mac-mlx-env` and Python 3.12; override with `MLX_SERVER_VENV` or `MLX_SERVER_PYTHON` for experiments.

### Shell semantics: Pi tool vs user terminal

Pi's tool is named `bash`. On this Mac, Pi 0.80.3 runs that tool through non-interactive `/bin/bash -c` by default, even when the user's interactive terminal shell is fish. Keep Pi's tool shell on bash/POSIX semantics for portability unless you intentionally want every model-generated shell command to run through fish.

For agent-safe automation, prefer direct venv executables instead of activation:

```bash
~/projects/mac-mlx-env/bin/python --version
~/projects/mac-mlx-env/bin/mlx_lm.server --help
```

If you want interactive activation in your own terminal, use the shell-specific entry point:

```bash
# bash / zsh
source ~/projects/mac-mlx-env/bin/activate
```

```fish
# fish
source ~/projects/mac-mlx-env/bin/activate.fish
```

Do not set this in `~/.pi/agent/settings.json` by default:

```json
{
  "shellPath": "/opt/homebrew/bin/fish"
}
```

That would make Pi's `bash` tool execute commands via `fish -c`. It may make fish snippets work, but most model-generated commands and setup examples assume POSIX/bash behavior, so it is more likely to create failures than fix them.

### Launch the server

Primary offline model:

```bash
~/projects/mac-mlx-env/bin/mlx_lm.server \
  --model mlx-community/Qwen3.6-27B-4bit \
  --host 127.0.0.1 \
  --port 8080 \
  --prompt-concurrency 1 \
  --decode-concurrency 4
```

After the server is listening, verify the id pi will see:

```bash
curl -s http://localhost:8080/v1/models | jq
```

`mlx_lm.server` reports every MLX model found in the local HF cache at `/v1/models`, not just the one loaded — match on the `--model` value you passed, which is also what must appear in `models.json`. Unlike `mlx-openai-server`, there is no `--served-model-name` flag, so the id is always the HF repo id.

For day-to-day use, prefer the repo wrapper:

```bash
scripts/pi-mlx-local.sh -p "Reply with exactly: ok"
```

Install the short command with:

```bash
ln -sfn ~/projects/pi-agent-config/scripts/pi-mlx-local.sh ~/.local/bin/pi-mlx-local
```

`pi-mlx-local` reuses an existing server on port 8080 only when `/v1/models` reports `mlx-community/Qwen3.6-27B-4bit`. If another process owns the port, it exits with a clear error instead of killing or replacing that process. When it starts the server itself, logs go to `~/.local/state/pi-agent-config/mlx-lm-server.log`, and the server is left running after Pi exits.

### Local test commands

Run these after the env is created and the model weights are cached:

```bash
# Verify the env and CLI.
~/projects/mac-mlx-env/bin/python --version
~/projects/mac-mlx-env/bin/mlx_lm.server --help

# In terminal 1: start the server.
~/projects/mac-mlx-env/bin/mlx_lm.server \
  --model mlx-community/Qwen3.6-27B-4bit \
  --host 127.0.0.1 \
  --port 8080 \
  --prompt-concurrency 1 \
  --decode-concurrency 4

# In terminal 2: verify the OpenAI-compatible endpoint.
curl -s http://127.0.0.1:8080/v1/models | jq
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer mlx-local' \
  -d '{"model":"mlx-community/Qwen3.6-27B-4bit","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":16}' | jq

# Verify pi sees the provider/model from models.json.
pi --list-models

# Smoke-test pi against the local server.
pi --provider mlx-local --model mlx-community/Qwen3.6-27B-4bit -p "Reply with exactly: ok"
```

For the offline dry-run, turn Wi-Fi off after the model has loaded once from cache, restart the server, and repeat the `curl` and `pi -p` smoke tests. Then open an interactive pi session, use `/plan`, confirm diagnostic `bash` is available behind confirmation while `edit`/`write` are unavailable, switch back with `/ask`, and run a small read-edit-checkpoint loop.

### Model picks for 32 GB unified memory

| Model | Size on disk | Fits 32 GB? | Notes |
|---|---|---|---|
| `mlx-community/Qwen3.6-27B-4bit` | ~15 GB | ✅ recommended | Dense 27B, official mlx-community straightforward 4-bit conversion (verified via file sizes — not the same as `unsloth/Qwen3.6-27B-UD-MLX-4bit`, ~26 GB, Unsloth "Dynamic" mixed-precision quant closer to 8-bit average size). Primary offline pi harness model as of 2026-07-17, chosen over Devstral after a same-day head-to-head: near-identical disk/RAM footprint and prefill speed, but Qwen3.6-27B's published SWE-Bench (77.2%) is well ahead of Devstral's (68.0%) — see [Measurements](#measurements) for the raw comparison |
| `mlx-community/Devstral-Small-2-24B-Instruct-2512-4bit` | ~15 GB | ✅ works, no longer used | Dense 24B, purpose-built for agentic coding; was primary for a few hours on 2026-07-17 before the Qwen3.6-27B comparison above. Local cache deleted 2026-07-17 to reclaim disk; re-download if reverting |
| `mlx-community/Qwen3.6-35B-A3B-OptiQ-4bit` | ~22 GB | ✅ works, no longer used | MoE 3B active; was the primary model through 2026-07-17. Local cache deleted 2026-07-17 to reclaim disk; re-download if reverting |
| `unsloth/Qwen3.6-27B-UD-MLX-4bit` | ~26 GB | ⚠ tight, not tested | Same base model as the recommended pick above but Unsloth's higher-effective-precision "Dynamic" quant; worth testing if 4-bit quality ever looks insufficient, but leaves much less KV-cache headroom |
| `unsloth/Qwen3.6-27B-MLX-8bit` | ~28 GB | ❌ skip | No usable headroom |

### MTPLX — future option, currently unusable

[MTPLX](https://github.com/youssofal/MTPLX) is a native MTP-aware MLX runtime claiming ~2.24× decode TPS on Qwen3.6 27B by actually executing the MTP heads as a built-in speculative decoder. It also exposes an OpenAI-compatible server, so it would slot into the same `mlx-local` provider shape.

**Cannot be used on this M1 Pro 32 GB** — MTPLX requires a minimum of **48 GiB unified memory** (warns below that floor; refuses to run above 80% utilization). Revisit when/if the host machine is upgraded.

### Current Pi context status

`mlx_lm.server` has no `--context-length` flag — there is no hard server-side cap. `contextWindow` in `models.json` is purely a Pi-side compaction trigger, and it needs a real measured ceiling behind it so Pi never lets a session grow past what this Mac can actually hold in memory before `mlx_lm.server` OOMs (which, unlike a graceful truncation, would crash the server mid-task).

| Model | Pi-visible context | Pi-visible max output | Thinking | Images |
|---|---:|---:|---|---|
| `mlx-community/Qwen3.6-27B-4bit` | 30.0K | 14.3K | yes | no |

Source of truth:

- [`pi-config/models.json`](./pi-config/models.json) sets the `mlx-local` model `contextWindow` to `32768`, `reasoning` to `true`, and `input` to `["text"]`.
- Pi-visible max output is `contextWindow - compaction.reserveTokens` (default `reserveTokens` 16384, unset in `~/.pi/agent/settings.json`).
- `32768` is not itself a direct measurement — it's bounded interpolation between two real measured points: 30017 tokens ran comfortably (23 GB peak, several GB free throughout) and 48017 tokens ran but with under 1 GB free for extended stretches. 32768 sits much closer to the comfortable end. Native `max_position_embeddings` is 262144, far above any of these numbers. See [Measurements](#measurements) below for both data points.

### Pi smoke usage sample

Measured 2026-07-17 with a no-session Pi JSON run against Qwen3.6 27B, which includes Pi's real system prompt and tool overhead instead of only the raw `/v1/chat/completions` prompt.

| Command | Input | Output | Total tokens | Cache read | Cache write | Context used | Headroom |
|---|---:|---:|---:|---:|---:|---:|---:|
| `PI_OFFLINE=1 pi --mode json --no-session -p "Reply with exactly: ok"` | 1 | 23 | 5313 | 5289 | 0 | ~16.2% of 32768 | ~27455 tokens |

This was a warm prompt-cache run — it followed an earlier `pi -p "Reply with exactly: ok"` smoke test that primed the same ~5289-token system prompt, hence `cacheRead=5289` and `input=1`. A cold run's `input` would be close to the full 5289 instead. `output=23` (vs 2 for the non-thinking Devstral run at the same prompt) reflects Qwen3.6's default thinking mode — the response includes a short `thinking` block before the final `ok`.

### Measurements

Measured 2026-07-17 on this Mac, single model resident, no other large processes running (avoid running two `mlx_lm.server`/`mlx-openai-server` instances at once — this host doesn't have room for two loaded models simultaneously and it was previously verified via Activity Monitor to force ~20 GB into swap, invalidating any timing/memory measurement taken under those conditions).

| Quantity | Qwen3.6 27B (current) | Devstral 24B (superseded same day) | How measured |
|---|---:|---:|---|
| Wall RAM at idle (model loaded, no context) | 15 GB resident | 14 GB resident | `top -l 1 -pid <pid> -stats mem` right after `/v1/models` responds |
| Test prompt size | 30017 tokens | 32010 tokens | Same synthetic large-prompt text, different tokenizer |
| Peak RAM @ test prompt | 23 GB resident, 0 swap | 24 GB resident, 0 swap | Same `top` sampling, polled every 5s during a real `/v1/chat/completions` call |
| Prefill throughput | 30017 tokens in 708s ≈ **42.4 tok/s** | 32010 tokens in 814s ≈ 39.3 tok/s | Wall-clock a single large-prompt `curl` request |
| Published SWE-Bench Verified | **77.2%** | 68.0% | Vendor-published, not independently verified at this specific 4-bit quant |
| Pi auto-compaction threshold | `contextWindow` **32768** in `pi-config/models.json` | 32768 (no longer live, same number by coincidence) | Interpolated between two real measured points — see the ceiling-test note below |

Both models are dense (all params active per token, unlike the old Qwen3.6-35B-A3B MoE setup) — this prefill rate is roughly **9× slower** than that MoE setup's observed ~364 tok/s prefill (3B active). This was a known, accepted trade-off: less memory pressure and a larger safe context window than the old 24576 cap, at the cost of prefill speed on large prompts. See [Why active params matter](#why-active-params-matter-and-toks-alone-doesnt).

Qwen3.6 27B won the comparison on published benchmark quality at essentially identical size/speed/memory cost, which is why it replaced Devstral as primary within the same day.

**Ceiling test (2026-07-18):** pushed a real 48017-token prompt at the live production server to find the actual limit, not just extrapolate. Result: it completed (HTTP 200, 1194s ≈ 40.2 tok/s), but system-wide free memory dropped under 1 GB repeatedly for extended stretches, and total wired memory peaked at 26 GB — well above the model process's own steady-state resident size, because transient GPU compute buffers during active prefill spike higher than the settled per-token KV-cache growth rate would predict (the simple ~266 KB/token model from the 30017-token test undershoots the real peak at this size). Two preconditions were needed even to attempt it safely: no other model server running, and `purge` (via `sudo purge`) to clear ~7 GB of stale compressor pages that had accumulated over the session — without that, the same test failed to even start safely (636 MB free at idle).

**Conclusion: 48K tokens works but has no real safety margin on this 32 GB Mac, especially with other apps (browser, IDE) also resident.** Don't run production at 48017. But the gap between the two real data points (comfortable at 30017, tight at 48017) is wide enough to interpolate a value confidently: `contextWindow` was raised **30720 → 32768**, a small, safely-bounded step from the comfortable end, not a leap toward the tight end. This was not independently re-measured at exactly 32768 — if a future OOM occurs, the first thing to check is whether this specific value needs its own direct test rather than trusting the interpolation further.

### Pi usage notes

- Plain `pi` now defaults to provider `mlx-local`, model `mlx-community/Qwen3.6-27B-4bit`; use `pi-mlx-local` when you want the wrapper to start or reuse `mlx_lm.server` first.
- Use `/model` only when you intentionally want to switch away from the Mac `mlx-local` default.
- `input` is restricted to `["text"]` — vision goes through `mlx_vlm` which is the broken path. If you need image input on Mac, use the Linux LM Studio entries.
- Use `/plan` for planning and inspection. Confirmed `bash` is available there for diagnostics such as `git status`, `rg`, `ls`, and endpoint probes.
- Switch to `/ask` before file edits, installs, test runs with side effects, server starts, commits, pushes, or other state-changing commands.
- Keep `"supportsDeveloperRole": false` inside the `compat` block of each raw `mlx-local` model unless you have verified the server normalizes `developer` to `system`. Both Qwen3.6's and Devstral's chat templates only handle `system`/`user`/`assistant`/`tool` and raise on anything else; the flag tells pi to send `system`.

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

A copy-paste ready version is in [`pi-config/models.json`](./pi-config/models.json). The checked-in template is currently synced with the live Mac `~/.pi/agent/models.json`: LM Studio on `:1234`, Odysseus `llamacpp` on `:8000`, the default `mlx-local` Qwen3.6 35B A3B OptiQ harness on `:8080`, and an `ollama-cloud` placeholder. Key shape:

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://localhost:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        { "id": "qwen3.5-9b-tng-pkd-qwopus-coder-fable-polaris-mlx", "input": ["text", "image"], "contextWindow": 131072, "reasoning": true },
        { "id": "qwen/qwen3.6-27b", "input": ["text", "image"], "contextWindow": 34000, "reasoning": true },
        { "id": "gemma-4-12b-coder-fable5-composer2.5-nvfp4", "input": ["text", "image"], "contextWindow": 131072, "reasoning": true }
      ]
    },
    "llamacpp": {
      "baseUrl": "http://localhost:8000/v1",
      "api": "openai-completions",
      "apiKey": "llamacpp",
      "models": [
        { "id": "gemma-4-12b-it-qat-q4_0", "input": ["text"], "contextWindow": 131072, "reasoning": true }
      ]
    },
    "mlx-local": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "mlx-local",
      "models": [
        { "id": "mlx-community/Qwen3.6-27B-4bit", "input": ["text"], "contextWindow": 32768, "reasoning": true, "compat": { "thinkingFormat": "qwen", "supportsDeveloperRole": false } }
      ]
    },
    "ollama-cloud": {
      "baseUrl": "https://ollama.com/v1",
      "api": "openai-completions",
      "apiKey": "YOUR_OLLAMA_API_KEY_HERE",
      "models": [
        { "id": "kimi-k2.7-code:cloud", "input": ["text"], "contextWindow": 256000 }
      ]
    }
  }
}
```

The `id` strings must match the model id the server reports at `GET /v1/models` — verify with `curl -s http://localhost:1234/v1/models | jq` (LM Studio, CachyOS) or `curl -s http://localhost:8080/v1/models | jq` (`mlx_lm.server`, Mac) after loading a model. See **Mac alternative — mlx_lm.server on M1 Pro 32 GB** for setting up the second endpoint.

`contextWindow` must match the **Context Length** you set in LM Studio's load dialog for that model (see "Per-model deltas" below). Pi defaults to 128000 if omitted, which means auto-compaction won't fire until well past the model's actual loaded context — and LM Studio will silently truncate the prompt instead. If you change a model's context in LM Studio, change it here too. Verify with `pi --list-models`.

### Mac `llamacpp` provider (Odysseus llama-server)

The Mac config also carries a `llamacpp` provider pointing at a raw `llama-server` on `http://localhost:8000/v1` — the process Odysseus's Cookbook serves (currently `google/gemma-4-12B-it-qat-q4_0-gguf`, started with `-c 131072`, no `--mmproj` so **text-only**). Notes that differ from the other providers:

- llama.cpp serves **one fixed model per process** and **ignores the request `model` field**, so the "id must match `GET /v1/models`" rule does not apply here — the entry uses the cosmetic id `gemma-4-12b-it-qat-q4_0` (the server actually reports the full GGUF path, since `llama-server` has no `--alias` in this launch).
- `contextWindow` must mirror whatever `-c` the server was started with, same reasoning as the LM Studio entries.
- The server is **not always running** — start it from Odysseus (Cookbook → serve) or directly with the same flags. `curl -s http://localhost:8000/health` to check.
- Verified 2026-07-06: `pi --provider llamacpp --model gemma-4-12b-it-qat-q4_0 -p "Reply with exactly: ok"` returns a clean `ok`, no leaked reasoning tags. The `qwen-code-llamacpp` wrapper in `~/mlx-local-llm` targets the same endpoint for Qwen Code.

### Switching models inside pi

- `/model` slash command in the REPL, or
- `Ctrl+L` keyboard shortcut

### Current live Mac settings

The inspected live `~/.pi/agent/settings.json` currently sets plain `pi` to `defaultProvider: "mlx-local"` and `defaultModel: "mlx-community/Qwen3.6-27B-4bit"`. It also keeps `PI_OFFLINE: true`, `defaultThinkingLevel: "medium"`, and the external package list to `npm:pi-bar`. `~/.pi/agent/APPEND_SYSTEM.md` is symlinked to [`pi-config/APPEND_SYSTEM.md.example`](./pi-config/APPEND_SYSTEM.md.example), and the live symlinked extensions are `claude-mode`, `fetch`, `web-search`, `git-checkpoint`, `question`, and `todo-tracker`.

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
- **`/plan`** — planning mode. Active tools restricted to `read, bash, grep, find, ls, question`; `bash` still asks for confirmation, `write`/`edit` are unavailable.
- **`/yolo`** — disable the gate for the rest of the session (asks for one confirmation).
- **`/ask`** — restore default gated behavior, clears any "always" memory.
- **`/online`** — add `web_search` and read-only `fetch` to the active tool list. `fetch` is limited to `GET` and `HEAD`; use confirmed `bash` for intentional network mutation.
- **`/offline`** — remove web tools again. This is the startup default.
- **`/trust-status`** — print current safety mode, network mode, active tools, and remembered allow-list.
- **`/trust-tool <name>`** — pre-allow a single gated tool (`bash`, `edit`, or `write`) for the session without going through a prompt. `/untrust-tool <name>` revokes it.
- Footer shows `[ask offline]` / `[plan online]` / `[yolo offline]` style status. State resets every session.

Install (one-time symlink so edits in this repo take effect live):

```fish
mkdir -p ~/.pi/agent/extensions
ln -s ~/projects/pi-agent-config/pi-config/extensions/claude-mode ~/.pi/agent/extensions/claude-mode
```

Pi auto-discovers `~/.pi/agent/extensions/*/index.ts` — no settings.json entry needed. See [`pi-config/extensions/claude-mode/README.md`](./pi-config/extensions/claude-mode/README.md) for design notes and known limits.

### Additional extensions

For the slim offline harness, keep only the extensions that provide Claude-Code-like essentials without extra package assumptions. `claude-mode` restores only `read, bash, edit, write, grep, find, ls, question, todo` on `/ask`; `/plan` keeps `read, bash, grep, find, ls, question`. `/online` adds only `web_search` and read-only `fetch`; `/offline` removes both again. Tools such as `ast-grep`, `test`, `remember`, and `forget` intentionally do not reappear after mode toggles.

| Extension | What it does | Commands |
|---|---|---|
| **git-checkpoint** | Commits before each agent turn; offers restore on `/fork`. Note: rewrites your working-tree commits while pi runs — incompatible with `git add -p` workflows. Use `/checkpoint-off` to pause without unloading. | `/checkpoint`, `/checkpoints`, `/restore <sha>`, `/checkpoint-off`, `/checkpoint-on` |
| **todo-tracker** | `todo` tool for the LLM to manage a task list; status widget shows `done/total` | `/todos` |
| **question** | `question` tool that pauses the agent mid-turn for user input. Full custom TUI: ↑/↓ to navigate supplied options, Enter to pick, or pick "Type something." for a free-form answer. Esc cancels. Headless `pi -p` returns an error result instead of blocking. Vendored from the upstream pi example. Added to both `ASK_TOOLS` and `PLAN_TOOLS` — UI only, no side effects. | _(no slash commands)_ |
| **web-search** | `web_search` tool backed by DuckDuckGo HTML results, no API key. Useful but parser-brittle because the HTML endpoint is not a stable official search API. Only active after `/online`. | _(no slash commands)_ |
| **fetch** | `fetch` tool for HTTP/HTTPS URL reads. When enabled through `claude-mode` `/online`, only `GET` and `HEAD` are allowed. | _(no slash commands)_ |

Install the live set:

```fish
for ext in git-checkpoint todo-tracker question web-search fetch;
  ln -sf ~/projects/pi-agent-config/pi-config/extensions/$ext ~/.pi/agent/extensions/$ext;
end
```

Verification notes for the web toggle: start pi and confirm the footer is `[ask offline]`; `/trust-status` should show `network: offline` and no web tools. Run `/online` and confirm `web_search` plus `fetch` appear in active tools, `web_search` returns results for a known query, `fetch` can `GET` one result URL, and `fetch` with `POST` is blocked. `/offline` should remove both web tools again. `/plan` + `/online` should allow web reads while `edit` and `write` remain unavailable.

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

### External packages

Beyond the in-repo extensions/skills above, the live setup installs these npm packages via `pi install` (recorded in `~/.pi/agent/settings.json` under `packages`):

```bash
pi install npm:pi-bar
```

Keep the package set this small for the offline Qwen harness. Do not reinstall `@plannotator/pi-extension`, `@dreki-gg/pi-plan-mode`, or task/subagent packages unless you intentionally want a heavier workflow; they overlap with `claude-mode`, add plan/task systems, or assume cloud-model handoff patterns.

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

## Change notes

### 2026-07-18
- Ran a real ceiling test on the live Mac production server to check whether `contextWindow` (30720) could safely be raised, rather than guessing from the linear growth-rate projection noted the day before. Sent a real 48017-token prompt: it completed (HTTP 200, 1194s ≈ 40.2 tok/s) but drove system-wide free memory under 1 GB for extended stretches and wired memory to a 26 GB peak — well above what the simple per-token KV growth estimate predicted, because transient GPU compute buffers during active prefill spike higher than steady-state resident size. Needed `sudo purge` first to clear ~7 GB of stale compressor pages accumulated over the session; without it, the test wasn't even safe to attempt (636 MB free at idle).
- Raised `contextWindow` **30720 → 32768** based on bounded interpolation between the two real data points (comfortable at 30017 tokens, tight at 48017 tokens) — not a fresh direct measurement at 32768 itself. Updated `pi-config/models.json` and the live `~/.pi/agent/models.json` to match.

### 2026-07-17
- Switched the Mac `mlx-local` primary model from Qwen3.6 35B A3B (MoE) to **Qwen3.6 27B dense** (`mlx-community/Qwen3.6-27B-4bit`, ~15 GB), via a same-day Devstral Small 2 24B detour. Full sequence:
  1. Investigated Devstral Small 2 24B as a candidate for more context headroom. Found `mlx-openai-server` fundamentally broken for it — its own batch-scheduler thread doesn't register an MLX GPU stream, crashing with `RuntimeError: There is no Stream(gpu, N) in current thread` on Devstral's sliding-window attention cache, across both 1.8.1 and 1.6.3, even with an unreleased upstream `mlx-lm` fix (`ml-explore/mlx-lm#1181`, `#1256`).
  2. Switched the server layer to `mlx_lm.server` (bundled with `mlx-lm`), which doesn't hit the bug. Added [`scripts/setup-mac-mlx-env.sh`](./scripts/setup-mac-mlx-env.sh) pin to `mlx>=0.32.0` + `mlx-lm` from a specific unreleased git commit (`15b522f`) for the same fix.
  3. Deployed Devstral to production, measured a real 32010-token prompt: 24 GB peak resident, 0 swap, 814s (~39.3 tok/s prefill) — confirmed ~9× slower prefill than the outgoing MoE model, an accepted trade-off for the memory headroom. Set `contextWindow` to a directly-measured 32768.
  4. User pointed out an official `mlx-community/Qwen3.6-27B-4bit` quant exists at ~15 GB (distinct from the ~26 GB `unsloth` "Dynamic" quant this README previously documented as the dense-27B pick). Tested it head-to-head under the same conditions: 30017-token prompt, 23 GB peak, 708s (~42.4 tok/s) — essentially tied with Devstral on size/speed, but with a published SWE-Bench Verified of 77.2% vs Devstral's 68.0%.
  5. Switched primary to Qwen3.6 27B on that result. Deleted both the old Qwen3.6-35B-A3B (~23 GB) and Devstral (~14 GB) HF caches to reclaim disk. Set `contextWindow` to a directly-measured 30720 (real tested point: 30017 tokens, 23 GB peak).
- Updated [`scripts/pi-mlx-local.sh`](./scripts/pi-mlx-local.sh), [`pi-config/models.json`](./pi-config/models.json), and the live `~/.pi/agent/{models.json,settings.json}` accordingly. `reasoning` is back to `true` with `thinkingFormat: "qwen"` (Qwen3.6 thinks by default; Devstral did not).
- All testing before production cutover used a throwaway `uv` venv (`~/projects/mac-mlx-env-throwaway`) on a dedicated git branch, per this repo's convention of not risking the working production env; production itself was only touched after each candidate was verified working end-to-end via `pi`.
- Lesson learned mid-investigation: running two `mlx_lm.server`/`mlx-openai-server` instances simultaneously on this 32 GB host forces ~20 GB into swap (confirmed via Activity Monitor) and silently invalidates any timing/memory measurement taken under those conditions — always stop one model fully before loading another for a clean test.

### 2026-07-15
- Dropped the Mac `mlx-local` Qwen3.6 35B A3B OptiQ harness context window 32768 → 24576 (`scripts/pi-mlx-local.sh` `CONTEXT_LENGTH`, `pi-config/models.json` and live `~/.pi/agent/models.json` `contextWindow`) after an OOM at ~80% context usage (~26k of 32768 tokens) — well past where the default `compaction.reserveTokens` (16384) should have triggered compaction. 24576 matches the already-validated context length for the same model family on the ROCm host; still flagged as an unmeasured first-pass mitigation for this Mac specifically, not a confirmed safe ceiling. `compaction.reserveTokens`/`keepRecentTokens` were left at defaults — only the context-window lever was tuned this round.

### 2026-07-14
- Documented current Pi-visible context stats for the Mac `mlx-local` Qwen3.6 35B A3B OptiQ harness: 32768 configured context, 32.8K visible context, 16.4K visible max output, thinking on, text-only input, and a no-session smoke run using 5306 total tokens (~16.2%), including warm prompt-cache accounting.
- Added [`pi-config/extensions/web-search/`](./pi-config/extensions/web-search/) and new `claude-mode` `/online` / `/offline` commands. Startup remains offline; online mode adds `web_search` and read-only `fetch`, with `/trust-status` reporting both safety and network state.
- Raised the Mac `mlx-local` Qwen3.6 35B A3B OptiQ harness to 32768 context and added [`scripts/pi-mlx-local.sh`](./scripts/pi-mlx-local.sh), which starts or reuses `mlx-openai-server` before launching Pi.
- Set the live Mac Pi default to provider `mlx-local`, model `mlx-community/Qwen3.6-35B-A3B-OptiQ-4bit`, so plain `pi` uses the `mlx-openai-server` Qwen3.6 35B A3B OptiQ harness.
- Clarified the Mac shell split: Pi's `bash` tool is `/bin/bash -c` by default, the user's terminal can still be fish, direct `~/projects/mac-mlx-env/bin/...` executables are preferred for automation, and `shellPath: "/opt/homebrew/bin/fish"` is intentionally not recommended.
- Kept confirmed `bash` available in `claude-mode` `/plan` for diagnostic shell commands while continuing to block `write` and `edit`.
- Switched the Mac offline harness to `mlx-openai-server` on `127.0.0.1:8080`, with `uv` + Python 3.12 and `mlx-community/Qwen3.6-35B-A3B-OptiQ-4bit` as the primary model.
- Added [`scripts/setup-mac-mlx-env.sh`](./scripts/setup-mac-mlx-env.sh) for the reproducible `~/projects/mac-mlx-env` setup (`mlx-openai-server` + `hf_transfer`).
- Slimmed `claude-mode` restoration: `/ask` restores `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `question`, and `todo`; `/plan` keeps only `read`, `bash`, `grep`, `find`, `ls`, and `question`.
- Reduced the documented external package set to `npm:pi-bar`; heavier planning/task/subagent packages are now called out as intentionally excluded from the offline harness.

### 2026-07-06
- Added the **`llamacpp` provider** (Mac): pi → raw `llama-server` on `:8000`, the process Odysseus's Cookbook serves (`google/gemma-4-12B-it-qat-q4_0-gguf`, `-c 131072`, text-only). Cosmetic model id — llama.cpp ignores the request `model` field. Verified end-to-end with `pi --provider llamacpp -p`.
- Synced `pi-config/models.json` with the live Mac `~/.pi/agent/models.json`: added the `gemma-4-12b-coder-fable5-composer2.5-nvfp4` LM Studio entry (current default model), bumped Qwen3.6 27B `contextWindow` 32768 → 34000, added the `ollama-cloud` provider (API-key placeholder).
- Added the **External packages** section (the `pi install npm:...` set recorded in live `settings.json`); folded and deleted the scratch `temp.txt` that held it.

### 2026-05-16
- Added the first Mac-local `mlx-local` provider notes for an M1 Pro 32 GB host. The current documented path has since moved to `mlx-openai-server` plus [`scripts/setup-mac-mlx-env.sh`](./scripts/setup-mac-mlx-env.sh) and [`scripts/pi-mlx-local.sh`](./scripts/pi-mlx-local.sh).
- Confirmed the earlier Mac MLX server reported the **full absolute path** passed to `--model`, not the directory basename — `mlx-local` model `id` was per-machine on that path.
- Confirmed `--draft-model` and `--num-draft-tokens` are supported on 0.31.3; MTPLX's narrower remaining appeal is *MTP-aware* speculative decoding only.
- Fixed pi e2e 404 `Unexpected message role.` by adding `"supportsDeveloperRole": false` to the `mlx-local` compat block — pi was sending the `developer` role, which Qwen3.6's `chat_template.jinja` rejects. LM Studio masks this server-side, so `lmstudio` entries don't need the flag.
- Bumped Mac `contextWindow` 16384 → 32768 (KV pressure untested at 32k; flagged in Measurements pending).

### 2026-05-14
- Added `question` extension (vendored from the upstream pi example) — pauses the agent mid-turn for ↑/↓ option pick or a free-form answer; headless `pi -p` returns an error instead of blocking.
- Added `ast-grep` extension — wraps the [ast-grep](https://ast-grep.github.io/) CLI for structural (tree-sitter AST) code search with meta-variable captures. `--rewrite` deliberately not exposed.
- Added `test` extension — auto-detects pytest / vitest / jest / cargo / go and returns structured pass/fail with parsed `{file, line, message}`.
- Added `session-memory` extension — `remember` / `forget` tools backed by per-project JSON at `~/.pi/agent/memory/<slug>.json`; entries injected into the system prompt each turn so they survive compaction and new sessions from the same cwd.
- Added the **Git workflow** section to `APPEND_SYSTEM.md` so pi sessions follow the branch-per-change → `gh pr create` → `gh pr merge --merge --delete-branch` flow without re-learning it.
- Removed the stale `@juicesharp/rpiv-ask-user-question` reference — the in-repo `question` extension supersedes it.

### 2026-05-13
- Added four extensions: `git-checkpoint`, `protected-paths`, `todo-tracker`, `dirty-repo-guard`.
- Added `/checkpoint-off` / `/checkpoint-on`, per-project `.pi/protected-paths.json`, staged/unstaged split in `dirty-repo-guard` with a "checkpoint then proceed" option, `/trust-tool` / `/untrust-tool` in `claude-mode`.
- Added two starter skills: `diagnose-tool-call-failure`, `checkpoint-recovery-walkthrough`.
- Enabled `reasoning: true` + `compat.thinkingFormat: "qwen-chat-template"` on both Gemma 4 entries in `models.json`.
- Renamed `pi-config/SYSTEM.md.example` → `pi-config/APPEND_SYSTEM.md.example`; synced the live append-style system prompt.
- Added the **Error recovery** section to `APPEND_SYSTEM.md`.
- Added `fetch` extension — HTTP/HTTPS URL reads with custom headers, default 256 KB response cap (4 MB hard), 30 s timeout. Current `claude-mode` online usage allows only `GET` and `HEAD`.

### 2026-05-10
- Added `reasoning: true` and `compat: { thinkingFormat: "qwen" }` to both Qwen3.6 entries — both fields are required for thinking mode to fire over LM Studio's OpenAI-compat transport, otherwise `enable_thinking` is never sent.

### 2026-05-09
- Added `claude-mode` extension (confirmation gate + `/plan` / `/yolo` / `/ask` / `/trust` slash commands).
- Added initial `APPEND_SYSTEM.md` guidance.
- Corrected `input` arrays — all four models support Vision in LM Studio.
- Added per-model `contextWindow` so pi auto-compacts at the real loaded context instead of pi's 128k default.

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
