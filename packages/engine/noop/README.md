# @ikenga/pkg-engine-noop

A no-op implementation of the Ikenga `Engine` contract. It accepts sessions and
streams a single canned `message_delta` echoing the input, followed by a `done`
event.

## Why it exists

- **Test fixture** — proves the engine kernel's pluggability pattern and event
  flow without spawning a real model process.
- **Shell-without-AI mode** — lets the shell run end-to-end in environments
  where no AI engine is installed or desired.

## Enabling

The pkg ships preinstalled as a builtin under
`shell/src-tauri/resources/builtin-pkgs/com.ikenga.engine-noop/`. Select it as
the active engine via the shell's pkg manager UI or the engine setting.
