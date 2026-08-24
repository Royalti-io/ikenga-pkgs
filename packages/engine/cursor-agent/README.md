# @ikenga/pkg-engine-cursor-agent

Scaffold-only Cursor agent CLI engine for Ikenga. Runtime is stubbed — every
runtime method throws `cursor-agent runtime not implemented — see ADR-013
Phase 4`. The package exists so the multi-engine dispatcher, FE engine
catalog, and onboarding wizard can carry a stable `"cursor-agent"` engine
id today; the body fills out once the Cursor CLI is installable locally
and an `--acp`-equivalent flag is verified (expected shape: ACP passthrough
identical to `@ikenga/pkg-engine-gemini`). See
[ADR-013](https://github.com/ikenga-hq/ikenga/blob/main/docs/adr/013-multi-engine-runtime-wire-protocols.md)
§1 + §6.
