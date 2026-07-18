#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
import uuid
import urllib.error
import urllib.request


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()


def memory_snapshot():
    snap = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "memory_pressure": run(["memory_pressure"]),
        "vm_stat": run(["vm_stat"]),
    }
    return snap


def host_usage():
    out = run(["top", "-l", "1", "-n", "0"])
    for line in out.splitlines():
        if line.startswith("PhysMem:") or line.startswith("VM:"):
            yield line


def prompt_for(target_tokens, nonce):
    # The API's usage.prompt_tokens is the measured value. This filler only aims
    # to get near each tier without depending on a local tokenizer package.
    seed = (
        f"Benchmark nonce: {nonce}\n"
        "You are benchmarking local long-context inference. "
        "Read the repeated records, then answer with exactly the word ok. "
        "Do not summarize the records.\n\n"
    )
    record = (
        "record alpha beta gamma delta epsilon zeta eta theta iota kappa "
        "lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.\n"
    )
    approx_record_tokens = 28
    repeats = max(1, int(target_tokens / approx_record_tokens))
    return seed + (record * repeats) + "\nAnswer exactly: ok"


def post_json(url, payload, timeout):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, time.monotonic() - started, json.loads(body), None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return exc.code, time.monotonic() - started, parsed, None
    except Exception as exc:
        return None, time.monotonic() - started, None, repr(exc)


def get_json(url, timeout):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), None
    except Exception as exc:
        return None, None, repr(exc)


def compact_health(result):
    status, body, error = result
    if not isinstance(body, dict):
        return {"status": status, "error": error}
    keys = [
        "ok",
        "model",
        "generation_mode",
        "runtime_mode",
        "mtp_enabled",
        "depth",
        "context_window",
        "chip",
        "machine_model",
        "unified_memory_bytes",
    ]
    compact = {key: body.get(key) for key in keys if key in body}
    mlx_runtime = body.get("mlx_runtime")
    if isinstance(mlx_runtime, dict):
        compact["mlx_runtime"] = {"version": mlx_runtime.get("version")}
    profile = body.get("profile")
    if isinstance(profile, dict):
        compact["profile"] = {"name": profile.get("name"), "runtime_profile": profile.get("runtime_profile")}
    startup = body.get("startup")
    if isinstance(startup, dict):
        backend = startup.get("backend")
        if isinstance(backend, dict):
            compact["backend"] = {
                "backend_id": backend.get("backend_id"),
                "architecture_id": backend.get("architecture_id"),
                "model_family": backend.get("model_family"),
            }
    return {"status": status, "body": compact, "error": error}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--target-tokens", type=int, nargs="+", required=True)
    parser.add_argument("--max-tokens", type=int, default=64)
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--top-p", type=float, default=0.95)
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument("--timeout", type=int, default=2400)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    results = {
        "name": args.name,
        "base_url": base,
        "model": args.model,
        "command": " ".join(sys.argv),
        "pid": os.getpid(),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "sampler": {
            "temperature": args.temperature,
            "top_p": args.top_p,
            "top_k": args.top_k,
            "max_tokens": args.max_tokens,
        },
        "models_before": None,
        "health_before": None,
        "host_before": list(host_usage()),
        "memory_before": memory_snapshot(),
        "runs": [],
    }

    results["models_before"] = get_json(f"{base}/models", 10)
    results["health_before"] = compact_health(get_json(base.rsplit("/v1", 1)[0] + "/health", 10))

    for target in args.target_tokens:
        nonce = f"{args.name}-{target}-{uuid.uuid4()}"
        payload = {
            "model": args.model,
            "messages": [{"role": "user", "content": prompt_for(target, nonce)}],
            "max_tokens": args.max_tokens,
            "temperature": args.temperature,
            "top_p": args.top_p,
            "top_k": args.top_k,
        }
        before = memory_snapshot()
        status, wall, body, error = post_json(f"{base}/chat/completions", payload, args.timeout)
        after = memory_snapshot()
        usage = body.get("usage") if isinstance(body, dict) else None
        choice = None
        if isinstance(body, dict) and body.get("choices"):
            choice = body["choices"][0].get("finish_reason")
        prompt_tokens = usage.get("prompt_tokens") if isinstance(usage, dict) else None
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        approx_prefill_tps = None
        approx_total_tps = None
        if prompt_tokens and wall > 0:
            approx_prefill_tps = prompt_tokens / wall
        if completion_tokens is not None and wall > 0:
            approx_total_tps = ((prompt_tokens or 0) + completion_tokens) / wall
        results["runs"].append(
            {
                "target_tokens": target,
                "nonce": nonce,
                "http_status": status,
                "wall_seconds": wall,
                "usage": usage,
                "finish_reason": choice,
                "error": error,
                "approx_prompt_tokens_per_wall_second": approx_prefill_tps,
                "approx_total_tokens_per_wall_second": approx_total_tps,
                "host_after": list(host_usage()),
                "memory_before": before,
                "memory_after": after,
                "response_keys": sorted(body.keys()) if isinstance(body, dict) else None,
            }
        )
        print(
            json.dumps(
                {
                    "name": args.name,
                    "target": target,
                    "status": status,
                    "wall_seconds": round(wall, 3),
                    "usage": usage,
                    "error": error,
                },
                sort_keys=True,
            ),
            flush=True,
        )

    results["host_after"] = list(host_usage())
    results["memory_after"] = memory_snapshot()
    results["models_after"] = get_json(f"{base}/models", 10)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
