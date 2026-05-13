---
name: checkpoint-recovery-walkthrough
description: Recover the working tree after a bad agent edit using the git-checkpoint extension. Codifies the /checkpoints → identify SHA → /restore → verify flow, plus the fallback for when the in-memory checkpoint list is empty (different session, pi restarted, etc.). Use when the agent has just made changes you want to undo, or when you want to roll back to a known-good state from earlier in this or a previous pi session.
---

# Checkpoint recovery

Use when a turn made changes you want to undo and the working tree is in a worse state than before. The `git-checkpoint` extension commits before every turn that has uncommitted changes (unless paused via `/checkpoint-off`), so there's almost always a recent commit to roll back to.

## 1. See what would be lost

```
/dirty
```

`dirty-repo-guard` reports staged vs unstaged separately. If you have changes you want to keep, commit them normally first — `/restore` is destructive.

If you want both the current state preserved *and* to test a restore, take a manual checkpoint first:

```
/checkpoint pre-restore safety
```

## 2. List recent checkpoints from this session

```
/checkpoints
```

Each line shows `<short-sha>  <time>  <message>`. The `before turn` entries are the automatic ones; manual ones use whatever message you gave to `/checkpoint`.

If the list is empty, the extension created no checkpoints in this session — see step 5.

## 3. Pick the right SHA

Look for the most recent checkpoint *before* the change you want to undo. Timestamps and messages help. If you're unsure, run `git show <sha>` (via `bash`) to inspect what state that commit captured.

## 4. Restore

```
/restore <sha>
```

This runs `git reset --hard <sha>` followed by `git clean -fd`. Important: the clean step removes untracked files the agent created after the checkpoint, but **respects `.gitignore`** — anything genuinely ignored survives.

## 5. Verify

```bash
git status
git log --oneline -5
```

Working tree should be clean and HEAD should be at the chosen checkpoint SHA.

## 6. If the in-session checkpoint list is empty

This happens after a pi restart, in a fresh session, or when `git-checkpoint` was paused (`/checkpoint-off`). The commits still exist in `git log`:

```bash
git log --grep="\\[pi-checkpoint\\]" --oneline
```

That shows every pi-generated checkpoint across sessions, including `before turn`, `before fork`, and `before switch session` commits (the last two come from `dirty-repo-guard`'s "checkpoint then proceed" option). Pick the SHA, then:

```
/restore <sha>
```

or, outside pi:

```bash
git reset --hard <sha>
git clean -fd
```

## 7. Resume normally

After a successful restore, taking a fresh `/checkpoint` is a good habit so subsequent recovery has a clean starting point.

## Caveats

- `/restore` does not touch ignored files — that includes `.env`, `node_modules/`, build outputs. If the agent corrupted one of those, restore won't fix it. (Protected-paths refuses to write most of them anyway.)
- If you restore *past* a checkpoint that lives at `HEAD~N`, the intermediate checkpoints are still reachable via `git reflog`, but `git log` from the new HEAD won't show them. Use `git reflog` to find anything you accidentally restored past.
- The auto-checkpoint only fires when the working tree has uncommitted changes at turn start. A turn that produces no edits leaves no checkpoint.
