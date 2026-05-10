# LM Studio per-model preset storage

When you check **"Remember settings for `<model-id>`"** in the load dialog, LM Studio writes the full advanced-settings payload to:

```
~/.lmstudio/.internal/user-concrete-model-default-config/<model-id>.json
```

One file per model id. Path format mirrors the model's HuggingFace org/repo (e.g., `google__gemma-4-26b-a4b.json`).

## Backup recipe

If you ever blow away `~/.lmstudio/` or move to a new machine, snapshot the preset directory first:

```fish
cp -r ~/.lmstudio/.internal/user-concrete-model-default-config ~/projects/pi-agent-config/lmstudio-presets/snapshot-(date +%Y%m%d)/
```

Then restore by copying back into the same path on the new machine.

## When to edit these files directly

Almost never. Every advanced setting is exposed in the GUI once you toggle **Show advanced settings**. The only legitimate reason to hand-edit:

- Scripting LM Studio config across multiple machines (in which case keep the snapshots in this directory under version control)
- Setting an option LM Studio's UI hasn't surfaced yet (rare)

Otherwise: change settings in the dialog, click Load, and let LM Studio persist them.

## Reading the file format

Each preset is a JSON object with keys roughly matching the dialog fields (`contextLength`, `gpuOffload`, `flashAttention`, `kCacheQuantization`, `vCacheQuantization`, etc.). The schema isn't formally documented and changes between LM Studio versions, so don't write tooling that depends on its stability.
