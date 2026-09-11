# pi-codex-quota-footer

A pi extension that adds OpenAI Codex subscription quota windows to the interactive footer.

The extension uses the active model's Codex OAuth token to query ChatGPT's internal usage endpoint. It refreshes when a session starts and after agent activity settles, while deduplicating and rate-limiting requests. Missing credentials, malformed tokens, network failures, and unsupported models leave quota marked unavailable without interrupting the session.

The ChatGPT usage endpoint is undocumented and may change without notice.
