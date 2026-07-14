# claude-mode

A pi.dev extension that adds Claude-Code-style ergonomics: a confirmation gate for shell and file-write tools, plus safety-mode and network-mode commands.

## What it does

**Confirmation gate (default).** Before pi runs `bash`, `write`, or `edit`, you get a 3-way prompt:

- **Yes** — allow this one call
- **No** — block; the model gets the denial reason and can retry differently
- **Always for this exact command** (bash) / **Always allow this tool this session** (write/edit) — remember the choice for the rest of the session

A `[ask offline]` indicator appears in the footer.

**Slash commands.**

| Command | Effect |
|---|---|
| `/plan` | Planning mode. Active offline tools restricted to `read, bash, grep, find, ls, question`. `bash` remains gated by confirmation; `write/edit` are removed from the model's tool list AND the gate blocks them defensively. Footer shows `[plan offline]` or `[plan online]`. |
| `/yolo` | Disable the bash/write/edit gate for this session. Asks for one confirmation first. Network mutation through `fetch` is still blocked. Footer shows `[yolo offline]` or `[yolo online]`. |
| `/ask`  | Restore default gated safety behavior. Clears any remembered "always" choices. Footer shows `[ask offline]` or `[ask online]`. |
| `/online` | Enable `web_search` and read-only `fetch` in the active tool list. `fetch` may only use `GET` or `HEAD`; use confirmed `bash` for intentional network mutation. |
| `/offline` | Remove `web_search` and `fetch` from the active tool list. This is the startup default. |
| `/trust-status` | Print current safety mode, network mode, active tools, and the auto-allow lists. |

State resets on every session start — there is no persistence. By design: the safe offline default should be re-asserted every launch.

`/ask` restores the slim offline harness tool set: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `question`, and `todo`. `/plan` keeps `bash` for inspection commands, but removes `edit`, `write`, and `todo`. `/online` adds `web_search` and `fetch` on top of either safety mode; `/offline` removes them again. Older optional tools such as `ast-grep`, `test`, `remember`, and `forget` are deliberately excluded so they do not reappear after mode toggles.

| Safety mode | Network mode | Active tools |
|---|---|---|
| ask/yolo | offline | `read, bash, edit, write, grep, find, ls, question, todo` |
| plan | offline | `read, bash, grep, find, ls, question` |
| ask/yolo | online | ask/yolo offline tools plus `web_search, fetch` |
| plan | online | plan offline tools plus `web_search, fetch` |

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

Inside pi, type `/` and look for `plan`, `yolo`, `ask`, `online`, `offline`, `trust-status`, `trust-tool`, and `untrust-tool` in the autocomplete. Or check the footer for `[ask offline]`.

If something goes wrong, pi reports extension load errors in `/tree` (Esc Esc).

## Known limitations

- "Always for this exact command" matches the bash command string verbatim. `npm test` and `npm test --watch` are different commands and prompt separately. This is intentional — it stops typo-driven trust-creep.
- "Always allow this tool" for write/edit is per-tool, not per-path. Granted once, all writes/edits this session bypass the gate. Use sparingly.
- Plan mode blocks file mutation, not shell inspection. `bash` remains available for commands like `git status`, `rg`, `ls`, and other diagnostics, with the same confirmation prompt used in `/ask`. Switch to `/ask` before edits, installs, server starts, commits, pushes, or any command whose purpose is to change system state.
- Online mode enables web reads only. `web_search` uses DuckDuckGo's HTML results without an API key, which is useful but parser-brittle because it is not a stable official search API. `fetch` is limited to `GET` and `HEAD` by `claude-mode`.
- The tool named `bash` is still Pi's shell tool; this extension does not make it fish-native. Keep model-generated shell commands POSIX/bash-compatible and use fish syntax only for commands you type directly in a fish terminal.
- There is a `plan-mode` example shipped with pi-mono. Don't load both — the `/plan` command will collide and pi will rename one to `/plan:1`.

## Why not just use the upstream `plan-mode` example?

It's a good extension, but its scope is broader (numbered-step extraction, [DONE:n] tracking, refine-the-plan editor) and it doesn't gate writes outside plan mode. This extension is the smaller, opinionated piece: gate + simple modes.
