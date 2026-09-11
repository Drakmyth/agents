# pi-mcp-manager

A [pi](https://github.com/earendil-works/pi-mono) extension for configuring Streamable HTTP MCP servers and making their tools available to agent sessions.

## Scope

- Connects to already-running Streamable HTTP servers.
- Supports MCP OAuth, environment-backed bearer headers, and global command credential profiles.
- Supports global and trusted project configuration.
- Activates tools automatically or on demand, with per-tool overrides.
- Does **not** download or execute MCP servers and does not support `stdio` or legacy SSE transports.

## Install

The extension is auto-discovered when this repository is used as pi's agent directory. Install its dependency first:

```sh
cd extensions/pi-mcp-manager
npm install
```

For another checkout, install the directory as a local pi package:

```sh
pi install /absolute/path/to/extensions/pi-mcp-manager
```

Do not both install and auto-discover the same checkout.

## Use

Run `/mcp` for a framed, server-first manager. Select a server to view its status, connection details, tools, and available actions. Management results remain inside the manager instead of appearing as transcript notifications.

Useful direct commands include:

```text
/mcp list
/mcp add
/mcp refresh <server-id>
/mcp login <server-id>
/mcp logout <server-id>
/mcp enable <server-id>
/mcp disable <server-id>
/mcp disconnect <server-id>
```

Adding a server, refreshing its catalog, or changing activation settings reloads pi's resources so the updated tool definitions are immediately usable.

Server states describe practical availability rather than whether an HTTP transport is currently open: `ready`, `needs refresh`, `login needed`, `unavailable`, `disabled`, or `checking`. The footer remains clear when no server needs attention.

## Files

- Global configuration: `~/.pi/agent/mcp.json`, or under `PI_CODING_AGENT_DIR`.
- Project configuration: `.pi/mcp.json`; loaded only for trusted projects.
- OAuth state and tokens: global `mcp-auth.json` beside the global configuration.

Project configuration may reference environment variables and global credential profiles, but cannot define command credential profiles. Project entries override global servers by server ID and can disable inherited servers.

Both configuration files use:

```json
{
  "format": "drakmyth.pi-mcp-manager",
  "version": 1,
  "servers": {}
}
```

## Security

Remote MCP tools can perform consequential actions. Review servers and disable tools you do not intend to expose.

OAuth tokens are stored unencrypted in `mcp-auth.json`, protected by the user account and filesystem permissions similarly to pi's `auth.json`. Credential commands are global-only, run directly without a shell, require interactive confirmation, time out, and must return one nonempty line. Resolved credentials are not written to configuration, sessions, catalogs, or diagnostics.

The OAuth redirect listener binds only to `127.0.0.1` on port `33418` and validates the OAuth state parameter.

## Development

```sh
npm run typecheck
npm test
```
