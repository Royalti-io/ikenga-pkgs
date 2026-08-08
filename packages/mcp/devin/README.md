# @ikenga/mcp-devin

Model Context Protocol (MCP) server that exposes the user's local Devin CLI to any Ikenga engine. It provides tools for single-turn prompt runs, session listing, session resuming, and fire-and-forget background task delegation backed by a durable SQLite/JSON task ledger.

## Installation

This package is distributed as part of the Ikenga packages repository.

```bash
# To run in development/hot-mount mode:
ikenga dev packages/mcp/devin
```

## Authentication

Authentication is handled out of band. Before running the MCP server, ensure you have the Devin CLI installed and you are authenticated:

```bash
devin login
```

## Available MCP Tools

- **`devin_status`**: Queries the local Devin CLI version and authentication state (`ready`, `not_installed`, or `not_authenticated`).
- **`devin_run`**: Runs a single-turn prompt synchronously via `devin -p "<prompt>"` and returns the output.
- **`devin_list_sessions`**: Lists task records from the local durable ledger.
- **`devin_resume`**: Resumes a previous Devin session with a follow-up prompt.
- **`devin_delegate`**: Starts a background Devin session, writes its execution logs, and returns a UUIDv4 `task_id`.
- **`devin_delegate_status`**: Polls the status of a background task. Returns a status string (`queued`, `running`, `awaiting_auth`, `done`, `failed`, `cancelled`, or `timed_out`) and a tail-truncated output log.
- **`devin_delegate_cancel`**: Terminates a running background task.

## Modes

The tools accept a `mode` parameter corresponding to Devin CLI's `--permission-mode`:
- `auto` (Default): Prompts the user before executing dangerous tools.
- `accept-edits`: Auto-approves file modifications but prompts for commands.
- `smart`: Uses a fast helper model to judge when to prompt.
- `dangerous`: Auto-approves all actions. **Use with extreme caution.**

## Timeouts

- **`devin_run` / `devin_resume`**: Default timeout of 120s, clamped between 5s and 900s.
- **`devin_delegate`**: Default timeout of 900s (15 minutes), clamped between 30s and 7200s (2 hours). Over-running tasks are sent a `SIGTERM` followed by a `SIGKILL` to prevent orphan processes.

## Concurrency Limit

The server enforces a concurrency limit of **3 active background tasks** at any time. Further delegation requests will be rejected with an error until an active task completes or is cancelled.
