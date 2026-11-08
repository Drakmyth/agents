# pi-agents-view

A persistent, terminal-native manager for concurrent Pi sessions. This initial milestone provides the cross-platform supervisor foundation used by the later Agent View interface and managed agent runtime.

## Current entry points

```text
pi --agents
/agents
```

Both entry points open the full-screen dashboard. `pi --agents` exits Pi when the dashboard closes; `/agents` returns to the foreground session.

## Foundation guarantees

- One per-user supervisor guarded by an exclusive lock
- Unix-domain socket IPC on Unix and a per-user named pipe on Windows
- Versioned, bounded JSONL messages
- Request deadlines, cancellation messages, and idempotency keys
- Atomic durable registry writes
- Detached startup and health checks
- Renewable client leases and automatic draining when the final view exits
- Persistent Pi RPC workers with launch, prompt, abort, stop, and resume operations
- Lifecycle classification and restart reconciliation for interrupted workers
- Automatic Git worktrees with selected-subdirectory preservation
- Direct execution with conflict warnings for non-Git directories
- Stable root-grouped dashboard with optional state or ungrouped views
- Claude-style persistent task composer with an explicit active dispatch root
- Filtering, abort, stop, and resume controls

When the final Agent View client exits, idle workers will stop immediately and executing workers will stop after their current turns. The supervisor then exits so Pi's installation files remain available to Winget. Reopening Agent View restores resumable sessions from the registry.

The planned navigation follows Claude Code Agent View: `/quit` from a directly opened session exits Pi, while `/quit` from a session entered through Agent View returns to the view; `/quit` from Agent View exits Pi. Pi's existing `/quit` command is reused without adding `/exit`.

State is stored under `~/.pi/agent/pi-agents-view/`.

## Development

```bash
npm install
npm run typecheck
npm test
```
