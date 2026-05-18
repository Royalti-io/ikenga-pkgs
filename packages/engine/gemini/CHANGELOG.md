# @ikenga/pkg-engine-gemini

## 0.2.0

### Minor Changes

- [`19a48a7`](https://github.com/Royalti-io/ikenga-pkgs/commit/19a48a7d21679135780296009cfcf487dd0513cf) Thanks [@nedjamez](https://github.com/nedjamez)! - First release. Ships the install-time `GeminiEngineAdapter` (ADR-012 Track G) — materializes pkg-shipped skills, commands, agents, and MCP entries into Gemini CLI's on-disk config tree (`~/.gemini/settings.json`, `~/.gemini/extensions/<slug>/`, `~/.gemini/commands/<slug>/<name>.toml`, `~/.gemini/agents/<slug>/`). Runtime `Engine` is a stub that throws — chat-runtime wiring is a separate slice.
