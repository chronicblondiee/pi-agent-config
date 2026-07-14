# claude-mode

A pi.dev extension that adds Claude-Code-style ergonomics: a confirmation gate for shell and file-write tools, plus three mode commands.

## What it does

**Confirmation gate (default).** Before pi runs `bash`, `write`, or `edit`, you get a 3-way prompt:

- **Yes** — allow this one call
- **No** — block; the model gets the denial reason and can retry differently
- **Always for this exact command** (bash) / **Always allow this tool this session** (write/edit) — remember the choice for the rest of the session

A `[ask]` indicator appears in the footer.

**Slash commands.**

| Command | Effect |
|---|---|
| `/plan` | Planning mode. Active tools restricted to `read, bash, grep, find, ls, question`. `bash` remains gated by confirmation; `write/edit` are removed from the model's tool list AND the gate blocks them defensively. Footer shows `[plan]`. |
| `/yolo` | Disable the gate for this session. Asks for one confirmation first. Footer shows `[yolo]`. |
| `/ask`  | Restore default behavior. Clears any remembered "always" choices. Footer shows `[ask]`. |
| `/trust-status` | Print current mode and the auto-allow lists. |

State resets on every session start — there is no persistence. By design: the safe default should be re-asserted every launch.

`/ask` restores the slim offline harness tool set: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `question`, and `todo`. `/plan` keeps `bash` for inspection commands, but removes `edit`, `write`, and `todo`. Older optional tools such as `fetch`, `ast-grep`, `test`, `remember`, and `forget` are deliberately excluded so they do not reappear after a `/plan` → `/ask` toggle.

## Install

This extension is auto-discovered by pi when present at `~/.pi/agent/extensions/claude-mode/index.ts`. The intended setup symlinks the directory from this repo into pi's config:

```fish
mkdir -p ~/.pi/agent/extensions
ln -s ~/projects/pi-agent-config/pi-config/extensions/claude-mode ~/.pi/agent/extensions/claude-mode
```

That way edits in this repo take effect on the next pi launch (or `/reload` inside pi).

No `npm install` is needed — pi loads the `.ts` file directly via jiti, and the only import is type-only (stripped at runtime). For IDE type resolution, optionally:

```fish
cd ~/projects/pi-agent-config/pi-config/extensions/claude-mode
npm init -y && npm i -D @earendil-works/pi-coding-agent
```

## Verifying it loaded

Inside pi, type `/` and look for `plan`, `yolo`, `ask`, `trust-status`, `trust-tool`, and `untrust-tool` in the autocomplete. Or check the footer for `[ask]`.

If something goes wrong, pi reports extension load errors in `/tree` (Esc Esc).

## Known limitations

- "Always for this exact command" matches the bash command string verbatim. `npm test` and `npm test --watch` are different commands and prompt separately. This is intentional — it stops typo-driven trust-creep.
- "Always allow this tool" for write/edit is per-tool, not per-path. Granted once, all writes/edits this session bypass the gate. Use sparingly.
- Plan mode blocks file mutation, not shell inspection. `bash` remains available for commands like `git status`, `rg`, `ls`, and other diagnostics, with the same confirmation prompt used in `/ask`. Switch to `/ask` before edits, installs, server starts, commits, pushes, or any command whose purpose is to change system state.
- The tool named `bash` is still Pi's shell tool; this extension does not make it fish-native. Keep model-generated shell commands POSIX/bash-compatible and use fish syntax only for commands you type directly in a fish terminal.
- There is a `plan-mode` example shipped with pi-mono. Don't load both — the `/plan` command will collide and pi will rename one to `/plan:1`.

## Why not just use the upstream `plan-mode` example?

It's a good extension, but its scope is broader (numbered-step extraction, [DONE:n] tracking, refine-the-plan editor) and it doesn't gate writes outside plan mode. This extension is the smaller, opinionated piece: gate + simple modes.
