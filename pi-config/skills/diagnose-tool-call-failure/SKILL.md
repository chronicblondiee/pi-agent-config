---
name: diagnose-tool-call-failure
description: Triage why a local LLM (LM Studio + pi.dev) is emitting malformed tool calls — wrong JSON, prose instead of structured calls, runaway closing tokens, or silently swallowed calls. Specific to this repo's pi + LM Studio + RX 7900 XTX setup. Use when pi reports a tool-call parse error, when the model narrates "I will now run X" instead of actually calling the tool, or when tool calls work for some prompts but break for others.
---

# Diagnose a tool-call failure

Use when pi shows a `tool_call parse failed` error, when the model describes what it would do instead of calling a tool, or when generation runs past the closing tag.

## 1. Capture the failure

Reproduce headless so the bad output is on stdout:

```bash
pi -p "<the prompt that broke>" 2>&1 | tee /tmp/tool-call-failure.log
```

Note: which model was loaded, what the prompt was, and the exact failure mode (malformed JSON / no call at all / call ran on).

## 2. Confirm pi can see the model and its tools

```bash
curl -s http://localhost:1234/v1/models | jq '.data[].id'
pi --list-models
```

The id in `~/.pi/agent/models.json` must match exactly what LM Studio reports. If not, pi will fall back silently and behave oddly.

## 3. Check the chat template in LM Studio

In LM Studio → Developer → loaded model → "Prompt Template". For tool-using models the template needs the model's native tool-call format (Qwen, Gemma, etc. each ship a different one). A wrong/older template is the single most common cause of malformed JSON.

If unsure: stop the model in LM Studio, reload it (LM Studio re-detects the template from the GGUF metadata), and retry.

## 4. Verify the tool-call reinforcement is loaded

`~/.pi/agent/APPEND_SYSTEM.md` is appended to pi's built-in system prompt. The example in `pi-config/SYSTEM.md.example` includes tool-call discipline language. If it's missing, especially Gemma will start narrating instead of calling.

```bash
test -f ~/.pi/agent/APPEND_SYSTEM.md && echo "present" || echo "missing — copy from pi-config/SYSTEM.md.example"
```

## 5. Verify `contextWindow` and `input` modalities

In `~/.pi/agent/models.json`, the loaded model's entry must have:
- `contextWindow` matching LM Studio's Context Length for that model (pi default 128000 is far above any local model; an absent value means pi never auto-compacts, and LM Studio silently truncates instead — which produces broken tool calls when the call gets cut in half).
- `input` listing every modality the model supports (`text`, `image`, …). Per the project README, all four loaded models support Vision in LM Studio — omitting `image` won't always break tool calls but does break Vision flows.

## 6. Rule out context overflow

If the failure only happens after a long session, you may have run past the loaded context:

- In an interactive pi session, run `/compact` and retry.
- Check `~/.lmstudio/.internal/user-concrete-model-default-config/<model-id>.json` for the actual Context Length the user-default preset sets.

## 7. Try the other model

Per the project README, Qwen 3.6 27B is noticeably more reliable on tool-call JSON than the Gemma variants. If you're on Gemma and steps 1–6 didn't fix it:

- Stop the Gemma model in LM Studio, load Qwen 3.6 27B at its measured context (see README's "Per-model deltas").
- Confirm the new id appears in `pi --list-models`.
- Re-run the failing prompt.

If Qwen also fails on the same prompt, the issue is the prompt / available tools / system prompt — not the model.

## 8. If the model still won't call the tool

Last-resort sanity check: ask the model to call a trivial tool (`read README.md`). If even that fails, the template / API plumbing is broken, not the prompt. Return to step 3.

## Reference

- Repo README "TL;DR — which model when" and "Decision tree" sections cover the Qwen vs Gemma reliability tradeoff measured on this hardware.
- `pi-config/SYSTEM.md.example` is the source for what APPEND_SYSTEM.md should contain.
- Live model configs: `~/.lmstudio/.internal/user-concrete-model-default-config/<model-id>.json`.
