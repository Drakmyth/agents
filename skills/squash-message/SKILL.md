---
name: squash-message
description: Generates a concise pull-request squash commit message from the active branch's final diff and relevant commits, optionally adds a configured co-author trailer, and copies it to the clipboard when supported. Invoke explicitly when a PR is ready to squash.
compatibility: Requires Git. GitHub CLI and a platform clipboard utility are optional.
disable-model-invocation: true
---

# Squash Message

Generate a squash commit message for the current branch. Do not edit project files, create commits, push, or modify the pull request.

## Configuration

Read the optional co-author identity from `git config --get agent.coAuthor`. Repository-local configuration takes precedence over global Git configuration. When configured, append exactly this trailer after the final blank line:

```text
Co-authored-by: <configured identity>
```

For example:

```sh
git config --global agent.coAuthor "Codex <codex@openai.com>"
```

Omit the trailer when `agent.coAuthor` is unset. Never infer an identity from the current harness or model.

## Workflow

1. Confirm the working directory is in a Git repository and inspect `git status --short`. Uncommitted changes do not prevent message generation, but clearly report that they are excluded.
2. Determine the comparison base in this order:
   - If GitHub CLI is available and the branch has an active pull request, use its base from `gh pr view --json baseRefName --jq .baseRefName`.
   - Otherwise use the remote default branch from `git symbolic-ref refs/remotes/origin/HEAD`.
   - Otherwise use `master` when it exists, then `main`.
   - Stop and ask for the base branch if none can be determined reliably.
   Prefer the remote-tracking ref for the selected branch when it exists.
3. Read:
   - `git log --reverse --format='%h %s%n%b' <base>..HEAD`
   - `git diff --stat <base>...HEAD`
   - `git diff --summary <base>...HEAD`
4. Base the message on the branch's net result, not a chronological transcript. Omit intermediate changes that were reverted, superseded, renamed again, or otherwise canceled out. Consolidate formatting, review-fix, and organizational commits into outcome-oriented bullets where relevant.
5. Do not include uncommitted changes because hosted squash operations use pushed commits. If `git status --short` is nonempty, mention this after presenting the message.
6. Produce:
   - an imperative, outcome-focused title, preferably no more than 72 characters;
   - a blank line;
   - 3–6 concise bullets describing the important final outcomes;
   - when configured, a blank line followed by the co-author trailer.
7. Avoid validation details, commit hashes, pull-request mechanics, and implementation chronology unless the user explicitly asks for them.
8. Attempt to copy the exact message to the clipboard using the first available platform utility:
   - macOS: `pbcopy`
   - Linux Wayland: `wl-copy`
   - Linux X11: `xclip -selection clipboard` or `xsel --clipboard --input`
   - Windows: PowerShell `Set-Clipboard` or `clip.exe`
9. Print the message in a fenced text block. Confirm whether it was copied; clipboard unavailability is not an error.

## Clipboard Safety

Write the message to a temporary UTF-8 file and redirect or pipe that file into the selected clipboard utility. Do not interpolate the message into a shell command. Delete the temporary file immediately afterward, including when clipboard copying fails.
