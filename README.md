# Local LLM + pi.dev setup reference

Personal reference for running [pi.dev](https://pi.dev/) (Mario Zechner's terminal coding agent harness) against local models served by LM Studio on this workstation.

**Last updated:** 2026-05-09 — added `claude-mode` extension (confirmation gate + `/plan` / `/yolo` / `/ask` / `/trust` slash commands), APPEND_SYSTEM.md guidance, corrected `input` arrays (all four models support Vision in LM Studio), and added `contextWindow` per model so pi auto-compacts at the real loaded context instead of pi's 128K default

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
        { "id": "qwen/qwen3.6-27b",          "input": ["text", "image"], "contextWindow": 65536 },
        { "id": "qwen/qwen3.6-35b-a3b",      "input": ["text", "image"], "contextWindow": 24576 },
        { "id": "google/gemma-4-26b-a4b",    "input": ["text", "image"], "contextWindow": 65536 },
        { "id": "google/gemma-4-31b",        "input": ["text", "image"], "contextWindow": 24576 }
      ]
    }
  }
}
```

The `id` strings must match the model id LM Studio reports at `GET http://localhost:1234/v1/models` — verify with `curl -s http://localhost:1234/v1/models | jq` after loading a model.

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

Drop a tighter system prompt at `~/.pi/agent/SYSTEM.md` (replaces pi's built-in) or `~/.pi/agent/APPEND_SYSTEM.md` (appends to it) to reinforce tool-call discipline — example at [`pi-config/SYSTEM.md.example`](./pi-config/SYSTEM.md.example). The append variant is safer; full replace makes you responsible for the tool-use instructions pi normally provides. Especially helpful for Gemma models, which are slightly less reliable on tool-call JSON than Qwen.

### claude-mode extension (confirmation gate + plan mode)

Pi has no built-in permission system or plan mode — both are deliberate non-features. The [`pi-config/extensions/claude-mode/`](./pi-config/extensions/claude-mode/) extension adds them:

- **Gate:** before `bash`, `write`, or `edit` runs, prompts `Yes / No / Always for this session`.
- **`/plan`** — read-only mode. Active tools restricted to `read, grep, find, ls`.
- **`/yolo`** — disable the gate for the rest of the session (asks for one confirmation).
- **`/ask`** — restore default gated behavior, clears any "always" memory.
- **`/trust`** — print current mode and remembered allow-list.
- Footer shows `[ask]` / `[plan]` / `[yolo]`. State resets every session.

Install (one-time symlink so edits in this repo take effect live):

```fish
mkdir -p ~/.pi/agent/extensions
ln -s ~/projects/local-llm-setup/pi-config/extensions/claude-mode ~/.pi/agent/extensions/claude-mode
```

Pi auto-discovers `~/.pi/agent/extensions/*/index.ts` — no settings.json entry needed. See [`pi-config/extensions/claude-mode/README.md`](./pi-config/extensions/claude-mode/README.md) for design notes and known limits.

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
