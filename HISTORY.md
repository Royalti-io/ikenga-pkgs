# History & migration

This pkg was extracted from the Ikenga shell on 2026-05-06 as a snapshot copy.

## Source files

From `royalti-io/ikenga`:

| Source (in shell) | Destination (in pkg) |
|---|---|
| `src-tauri/src/claude/` | `src-tauri/src/claude/` |
| `src-tauri/src/commands/claude.rs` | `src-tauri/src/commands/claude.rs` |
| `src/chat/` | `src/chat/` |
| `src/routes/sessions/` | `src/routes/sessions/` |
| `src/shell/claude-config/` | `src/shell/claude-config/` |

## Cutover plan

1. **Now** — snapshot pkg with own remote.
2. **Next** — split the chat layer cleanly:
   - `src/chat/adapter.ts` + `adapters/mock.ts` move to `@ikenga/contract` (or a shell-internal package) since they're engine-neutral.
   - `src/chat/adapters/claude-cli.ts` + `claude/` Rust + `claude.rs` command stay in this pkg.
   - `src/chat/store.ts`, `persist.ts`, `ui/`, `routes/sessions/` could become a separate `@ikenga/pkg-chat` UI pkg that talks to *any* engine pkg via the adapter contract.
3. **Then** — kernel registers this pkg as the active engine; chat UI resolves the active engine via the `Engine` interface in `@ikenga/contract`.
4. **Finally** — delete carved sources from the shell.

## Why this isn't already a kernel pkg

The `claude` integration predates the pkg-kernel work. It's wired directly into the shell's Rust core (`lib.rs` `invoke_handler` registers `claude_*` commands). The cutover above is the path to making it kernel-managed and swappable.

## Don't auto-install

This pkg is **not** placed in `shell/src-tauri/resources/builtin-pkgs/`. The kernel only auto-installs pkgs from that directory. Until the cutover lands, the shell uses its own internal copies; afterwards, the user can install this pkg explicitly via the Pkg Manager or `ikenga add com.ikenga.engine-claude-code`.
