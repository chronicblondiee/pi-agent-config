# Mac headless long-context runtime tests

**Status:** MTPLX promoted to the primary Mac-local Pi provider by operator decision on 2026-07-18 after one clean 32768-tier curl run and a successful Pi wrapper smoke test. The old `mlx_lm.server` provider remains configured as the fallback.

## Scope

This note tracks headless Mac runtime candidates for long-context Pi use on the 32 GB M1 Pro path. MTPLX is now the live primary path; `mlx-local`, `scripts/pi-mlx-local.sh`, and `~/projects/mac-mlx-env` remain available as the fallback.

## Candidate 1: MTPLX

MTPLX is the first test candidate because it is MLX-native, Qwen3.6/MTP-aware, exposes OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/health`, and `/metrics`, and its current docs say 27B targets 32 GB and up.

Pinned test setup:

```bash
scripts/setup-mac-mtplx-env.sh
```

Defaults:

| Setting | Value |
|---|---|
| Env | `~/projects/mac-mtplx-env` |
| Python | `3.12.13` requested; wrappers require `3.12.x` |
| MTPLX | `mtplx==2.1.0` |
| Port | `18080` |
| Pi config dir | `~/.pi/agent` for primary; `~/.pi/agent-mtplx-test` for isolated tests |
| Pi provider | `mtplx-local` for primary; `mtplx-test` for isolated tests |
| Pi model id | `mtplx-qwen36-27b-optimized-speed-fp16` |
| Candidate model | `Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16` |

If `mtplx inspect Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16` rejects the candidate, switch to the MTPLX-recommended Qwen3.6 27B catalog build before running load tests:

```bash
MTPLX_HF_MODEL=<catalog-build> scripts/pi-mtplx-local.sh -p "Reply with exactly: ok"
```

Use only the wrapper or the pinned venv binary:

```bash
~/projects/mac-mtplx-env/bin/mtplx --version
~/projects/mac-mtplx-env/bin/mtplx inspect Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16
```

Do not use bare `mtplx` from `PATH` for this test. A global MTPLX 1.x install can reject current runtime metadata and can default to port `8000`, which is not the isolated test endpoint.

For authenticated Hugging Face downloads in fish:

```fish
set -x HF_TOKEN <token>
```

The wrapper uses `mtplx quickstart --download` by default so the first run can populate the cache. For a strict cache-only run:

```bash
MTPLX_DOWNLOAD=0 scripts/pi-mtplx-test.sh -p "Reply with exactly: ok"
```

Curl-level tests come before Pi:

```bash
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18080/v1/models | jq
curl -fsS http://127.0.0.1:18080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"mtplx-qwen36-27b-optimized-speed-fp16","messages":[{"role":"user","content":"Reply with exactly: ok"}],"max_tokens":64}' | jq
```

Only after those pass, use the primary wrapper:

```bash
pi-mtplx-local --no-session -p "Reply with exactly: ok"
```

For isolated test config only:

```bash
PI_CODING_AGENT_DIR=$HOME/.pi/agent-mtplx-test \
  pi --provider mtplx-test --model mtplx-qwen36-27b-optimized-speed-fp16 --no-session -p "Reply with exactly: ok"
```

## Context tier order

Measure in this order:

| Tier | Decision gate |
|---:|---|
| 32768 | First stability tier; matches the current production Pi compaction window |
| 40960 | Try only if 32768 leaves clear memory headroom |
| 49152 | Candidate promotion ceiling unless it leaves no safety margin |
| 65536 | Try only if 49152 leaves at least 2-3 GB free with no swap storm |

Record this for every tier:

| Field | Value |
|---|---|
| Date | |
| Model | |
| Runtime | |
| Runtime version | |
| Command | |
| Context tokens | |
| Wall time | |
| Prefill tok/s | |
| Generated tok/s | |
| Peak RSS | |
| Wired memory peak | |
| Free memory low-water mark | |
| Swap used / swap delta | |
| HTTP status | |
| Server survived? | |
| Notes | |

## Benchmark results: MTPLX vs `mlx_lm.server`

Measured 2026-07-18 on the 32 GB M1 Pro, one server resident at a time. These are curl-level `/v1/chat/completions` runs, not Pi runs. Prompts used a unique leading nonce per request to avoid prompt-cache reuse; every published row below reported `cached_tokens: 0`.

Important comparison caveat: this is the practical runtime path comparison currently available in this branch, not a pure same-weights runtime benchmark. MTPLX used `Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed-FP16`; the control used the existing production Mac model `mlx-community/Qwen3.6-27B-4bit`.

Sampler settings were the Qwen coding settings used by MTPLX and passed explicitly to both endpoints: `temperature=0.6`, `top_p=0.95`, `top_k=20`, `max_tokens=64`.

| Target | Runtime | Model id | Prompt tokens | Generated tokens | Cached tokens | Wall time | Approx prompt tokens / wall s | HTTP | Server survived? |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1024 | MTPLX 2.1.0, sustained MTP | `mtplx-qwen36-27b-optimized-speed-fp16` | 1209 | 64 | 0 | 25.6s | 47.2 | 200 | yes |
| 1024 | `mlx_lm.server`, MLX 0.32.0 / mlx-lm git pin | `mlx-community/Qwen3.6-27B-4bit` | 1205 | 64 | 0 | 36.9s | 32.7 | 200 | yes |
| 8192 | MTPLX 2.1.0, sustained MTP | `mtplx-qwen36-27b-optimized-speed-fp16` | 9144 | 64 | 0 | 143.2s | 63.8 | 200 | yes |
| 8192 | `mlx_lm.server`, MLX 0.32.0 / mlx-lm git pin | `mlx-community/Qwen3.6-27B-4bit` | 9143 | 64 | 0 | 222.9s | 41.0 | 200 | yes |
| 32768 | MTPLX 2.1.0, sustained MTP | `mtplx-qwen36-27b-optimized-speed-fp16` | 36361 | 64 | 0 | 605.8s | 60.0 | 200 | yes |
| 32768 | `mlx_lm.server`, MLX 0.32.0 / mlx-lm git pin | `mlx-community/Qwen3.6-27B-4bit` | 36364 | 64 | 0 | 924.6s | 39.3 | 200 | yes |

Wall-time speedup from the control to MTPLX:

| Target | MTPLX speedup |
|---:|---:|
| 1024 | 1.44x |
| 8192 | 1.56x |
| 32768 | 1.53x |

Host memory snapshots from `top -l 1 -n 0`:

| Runtime / target | Before | After request | Notes |
|---|---|---|---|
| MTPLX / 32768 | `29G used`, `2080M wired`, `2832M unused` | `31G used`, `23G wired`, `241M unused` | Very tight; cumulative `vm_stat` swapout counter increased during the request, though `top` reported no active per-snapshot swapout delta. |
| `mlx_lm.server` / 32768 | `29G used`, `2009M wired`, `2726M unused` | `31G used`, `26G wired`, `255M unused` | Very tight; no cumulative swapout increase in the captured request window. |

Raw result files:

- [`research/results/mtplx-1024-8192-2026-07-18.json`](./results/mtplx-1024-8192-2026-07-18.json)
- [`research/results/mtplx-32768-2026-07-18.json`](./results/mtplx-32768-2026-07-18.json)
- [`research/results/mlx-1024-8192-2026-07-18.json`](./results/mlx-1024-8192-2026-07-18.json)
- [`research/results/mlx-32768-2026-07-18.json`](./results/mlx-32768-2026-07-18.json)

Interpretation: MTPLX is materially faster for this long-context curl workload, especially once the prompt is large enough for steady prefill behavior. Both runtimes completed one clean 32768-tier run, but neither has passed the branch promotion rule yet because the exact tier still needs a second clean run under comparable memory conditions. The 32768 memory margin is also narrow enough that 40960 should be treated as an exploratory stress test, not a default candidate.

## Candidate 2: `mlx_lm.server` control

Keep the existing production stack as the control candidate, but do not activate deeper/custom options until MTPLX results are known.

Pinned control stack:

| Component | Pin |
|---|---|
| `mlx` | `0.32.0` |
| `mlx-lm` release baseline | `0.31.3` |
| Current server-fix pin | `git+https://github.com/ml-explore/mlx-lm.git@15b522f593b7ca5fbc0cac6f7572d40859d2d8fe` |
| Production model | `mlx-community/Qwen3.6-27B-4bit` |

Inactive flags to test later:

```bash
--prefill-step-size 1024
--prompt-cache-size 1
--prompt-cache-bytes 1G
--prompt-concurrency 1
--decode-concurrency 1
```

Custom fallback, only if both server candidates fail: build a thin OpenAI-compatible wrapper around `mlx_lm.generate` to expose `--kv-bits`, `--quantized-kv-start`, and `--max-kv-size`.

## Promotion note

The original conservative rule was to promote no default changes unless an exact context tier passed two clean runs. The live default was promoted after one clean 32768-tier curl run because the operator explicitly chose MTPLX as the primary local Pi runtime. Residual risk: the 32768 tier still needs a second clean run under comparable memory conditions before treating it as fully characterized.

## Sources checked 2026-07-18

- MTPLX README: <https://github.com/youssofal/MTPLX>
- MTPLX PyPI: <https://pypi.org/project/mtplx/>
- MLX PyPI: <https://pypi.org/project/mlx/>
- mlx-lm PyPI: <https://pypi.org/project/mlx-lm/>
- mlx-lm README: <https://github.com/ml-explore/mlx-lm>
- mlx-lm issue #1308: <https://github.com/ml-explore/mlx-lm/issues/1308>
