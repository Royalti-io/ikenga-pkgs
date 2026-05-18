---
"@ikenga/pkg-engine-codex": minor
---

First release. Ships the install-time `CodexEngineAdapter` (ADR-012 Track C) — materializes pkg-shipped MCP entries into `~/.codex/config.toml` as `[mcp_servers.ikenga.<slug>.<name>]` tables, subagents into `~/.codex/agents/<slug>/<name>.toml` via the ADR §5 MD→TOML transcoder, and skills + commands into `<IKENGA_CODEX_PROJECT_ROOT>/.agents/skills/<slug>/` (gated on env var; the shell seeds it from the active project).

Per ADR §7 closure (2026-05-18): `${IKENGA_SECRET:...}` placeholders in env values translate to entries in Codex's `env_vars = [...]` allowlist (forwards from parent process env); plaintext secret-shaped keys are refused. Runtime `Engine` is a stub — chat-runtime wiring is a separate slice.
