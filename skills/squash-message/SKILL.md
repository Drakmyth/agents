---
name: squash-message
description: Generates a concise pull-request squash commit message from the active branch's final diff and relevant commits, adds a Codex co-author trailer, and copies it to the Windows clipboard. Invoke explicitly when a PR is ready to squash.
compatibility: Requires Git, GitHub CLI for PR-aware base detection, and Windows PowerShell clipboard support.
disable-model-invocation: true
---

# Squash Message

Generate and copy a squash commit message for the current branch. Do not edit project files, create commits, push, or modify the pull request.

## Workflow

1. Confirm the working directory is in a Git repository and inspect `git status --short`. Uncommitted changes do not prevent message generation, but clearly report that the message includes or excludes them as described below.
2. Determine the comparison base:
   - Prefer the active pull request's base from `gh pr view --json baseRefName --jq .baseRefName`.
   - Otherwise use the remote default branch from `git symbolic-ref refs/remotes/origin/HEAD`.
   - If neither works, use `master` when it exists, otherwise `main`.
3. Read both:
   - `git log --reverse --format='%h %s%n%b' <base>..HEAD`
   - `git diff --stat <base>...HEAD`
   - `git diff --summary <base>...HEAD`
4. Base the message on the branch's net result, not a chronological transcript. Omit intermediate changes that were reverted, superseded, renamed again, or otherwise canceled out. Consolidate formatting, review-fix, and organizational commits into outcome-oriented bullets where relevant.
5. Do not include uncommitted changes in the squash message because GitHub's squash operates on pushed commits. If `git status --short` is nonempty, mention this after copying the message.
6. Produce:
   - an imperative, outcome-focused title, preferably no more than 72 characters;
   - a blank line;
   - 3–6 concise bullets describing the important final outcomes;
   - a blank line;
   - exactly this trailer: `Co-authored-by: Codex <codex@openai.com>`.
7. Avoid validation details, commit hashes, PR mechanics, and implementation chronology unless the user explicitly asks for them.
8. Copy the exact complete message to the Windows clipboard without shell interpolation. Write it to a temporary UTF-8 file, use PowerShell `Get-Content -Raw <file> | Set-Clipboard`, then delete the temporary file.
9. Print the message in a fenced text block and confirm that it was copied. Keep the response concise.

## Clipboard Safety

Use a temporary file rather than embedding the message in a PowerShell command so backticks, dollar signs, quotes, and other shell-sensitive characters remain unchanged.
