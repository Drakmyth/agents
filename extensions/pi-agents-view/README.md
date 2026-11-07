# pi-agents-view

A persistent, terminal-native manager for concurrent Pi sessions. This initial milestone provides the cross-platform supervisor foundation used by the later Agent View interface and managed agent runtime.

## Current entry points

```text
pi --agents
/agents
```

The current command verifies or starts the detached supervisor. Agent dispatch and the full-screen dashboard are intentionally deferred until their runtime and UI contracts are implemented.

## Foundation guarantees

- One per-user supervisor guarded by an exclusive lock
- Unix-domain socket IPC on Unix and a per-user named pipe on Windows
- Versioned, bounded JSONL messages
- Request deadlines, cancellation messages, and idempotency keys
- Atomic durable registry writes
- Detached startup and health checks

State is stored under `~/.pi/agent/pi-agents-view/`.

## Development

```bash
npm install
npm run typecheck
npm test
```
