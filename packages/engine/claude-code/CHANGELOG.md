# @ikenga/pkg-engine-claude-code

## 0.2.1

### Patch Changes

- Republish with `manifest.json` version synced to the npm version. Previous
  tarballs shipped a stale manifest version, so the shell recorded the old
  version after every update and re-offered the same update forever.
  (`@ikenga/pkg-tasks` also catches its npm version up to the manifest's 0.8.x
  line — npm history jumps 0.4.1 → 0.8.1.)

## 0.2.0

### Minor Changes

- [`8a5d923`](https://github.com/Royalti-io/ikenga-pkgs/commit/8a5d923a6181125bc125c5642c81dba4faf053e1) Thanks [@nedjamez](https://github.com/nedjamez)! - Port 5 commits of engine adapter evolution from the now-archived `Royalti-io/ikenga-pkg-engine-claude-code` standalone clone, which had diverged after the original subtree-add at `6a53f810`.

  Bumps `@ikenga/contract` dep from `^0.4.0` to `^0.6.0` to pick up the new multi-file `./engine` subpath module that exports `AcpHost`, `HostBridge`, `AcpUnlisten`.

  Original commits preserved by ref: `18fa4e0 a692db9 36f3d68 f5914b1 d9b1705`.

  Substantive changes:

  - `refactor(engine)` import `Engine` + ACP types from `@ikenga/contract/engine` (#1) — replaces local interface duplication with the canonical contract surface.
  - `fix(engine)` satisfy new `Engine.metadata` required field.
  - `feat(acp)` host-injected `AcpEngine` factory.
  - `refactor` collapse pkg to headless engine adapter.
  - `chore` genericize slug-derivation example.

  Brings the canonical monorepo copy up to date so the legacy `pkgs/engine-claude-code/` workspace-link source in the meta-repo can be retired (separate step — requires shell to repoint from `workspace:*` to the published `@ikenga/pkg-engine-claude-code@0.2.0`).
