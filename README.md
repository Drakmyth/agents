# Portable agent configuration

Personal agent instructions and reusable skills, with optional harness-specific customizations.

## Resources

- `GLOBAL_AGENTS.md`: machine-global collaboration instructions, deliberately named so repository-aware harnesses do not load it automatically
- `skills/`: portable [Agent Skills](https://agentskills.io/) packages
- `extensions/`: pi-specific extensions
- `themes/`: pi-specific themes

Consumers can place or link each resource into the locations recognized by their chosen harness. Harness-specific extensions and themes are optional.

Credentials, sessions, trust decisions, generated model catalogs, binaries, dependency state, and live machine-specific settings are not tracked.

## Squash-message attribution

The squash-message skill reads an optional co-author identity from repository-local or global Git configuration:

```sh
git config --global agent.coAuthor "Codex <codex@openai.com>"
```

When the setting is absent, the skill omits the co-author trailer.
