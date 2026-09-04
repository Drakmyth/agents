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

To opt in on a machine, create an ignored `AGENTS.md` symbolic link (or equivalent) pointing to `GLOBAL_AGENTS.md`.

## Configure pi

Copy and adapt the settings example rather than tracking live settings:

```powershell
Copy-Item settings.example.json settings.json
```

```sh
cp settings.example.json settings.json
```

Authentication must be configured independently on every machine. Never copy `auth.json` into the repository.

The squash-message skill can add a co-author trailer configured globally or per repository:

```sh
git config --global agent.coAuthor "Codex <codex@openai.com>"
```

Omit the setting to generate messages without a co-author trailer.

## Other harnesses

Skills use the Agent Skills standard. Link `skills/` into a harness's supported global skills location; `~/.agents/skills` is the shared location supported by pi. Harness-specific extensions and themes remain under their named directories.
