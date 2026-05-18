---
"@ikenga/pkg-engine-gemini": minor
---

First release. Ships the install-time `GeminiEngineAdapter` (ADR-012 Track G) — materializes pkg-shipped skills, commands, agents, and MCP entries into Gemini CLI's on-disk config tree (`~/.gemini/settings.json`, `~/.gemini/extensions/<slug>/`, `~/.gemini/commands/<slug>/<name>.toml`, `~/.gemini/agents/<slug>/`). Runtime `Engine` is a stub that throws — chat-runtime wiring is a separate slice.
