# Portable agent configuration

Personal agent instructions, standard skills, and pi-specific customizations. The repository is designed to be checked out directly at pi's global configuration directory (`~/.pi/agent`).

## Tracked resources

- `GLOBAL_AGENTS.md`: canonical machine-global agent instructions
- `skills/`: portable [Agent Skills](https://agentskills.io/) packages
- `extensions/`: pi-specific extensions
- `themes/`: pi-specific themes
- `settings.example.json`: portable subset of pi preferences

Credentials, sessions, trust decisions, generated model catalogs, binaries, dependency state, and live machine-specific settings are ignored.

## Enable global instructions

The repository intentionally does not track a root `AGENTS.md`. This prevents clones and repository scrapers from automatically treating personal global instructions as repository directives.

Opt in on a machine by creating the ignored local link:

```powershell
./scripts/enable-global-agents.ps1
```

```sh
./scripts/enable-global-agents.sh
```

The PowerShell script falls back to an NTFS hard link when Windows symbolic links require elevation. Both forms keep edits to `AGENTS.md` and `GLOBAL_AGENTS.md` synchronized.

## Configure pi

Copy and adapt the settings example rather than tracking live settings:

```powershell
Copy-Item settings.example.json settings.json
```

```sh
cp settings.example.json settings.json
```

Authentication must be configured independently on every machine. Never copy `auth.json` into the repository.

## Other harnesses

Skills use the Agent Skills standard. Link `skills/` into a harness's supported global skills location; `~/.agents/skills` is the shared location supported by pi. Harness-specific extensions and themes remain under their named directories.
