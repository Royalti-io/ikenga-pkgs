# Conventions (consumed, not invented)

This is a **cached pointer** to the project's published rules. The authoritative
sources are the org [`CONTRIBUTING.md`](https://github.com/ikenga-hq/.github/blob/main/CONTRIBUTING.md)
and each repo's own files. If anything here looks stale, read the live source and
trust that. **Never state a rule to a contributor that you can't trace to one of
these sources.**

## Repos → package manager → changeset?

Mirrors the org `CONTRIBUTING.md` repo table. Pick the repo that owns the change;
use the package manager it already uses (don't introduce a foreign lockfile).

| Repo | Role | Package mgr | Changeset? |
|------|------|-------------|------------|
| `ikenga` | Tauri 2 desktop app + pkg kernel (the shell) | bun | no (not published) |
| `ikenga-contract` | manifest schema (Zod), RPC types, Engine interface | pnpm | **yes** |
| `ikenga-tokens` | design tokens (CSS + TS) | pnpm | **yes** |
| `ikenga-cli` | `ikenga` disk-side pkg manager | bun | **yes** |
| `iyke-cli` | `iyke` Rust runtime controller | cargo | no |
| `ikenga-pkgs` | monorepo for all pkgs (engines, MCP, apps, skills) | pnpm | **yes** |
| `ikenga-registry` | static JSON registry | — | no |
| `ikenga-site` | marketing site + docs | pnpm | no |
| `ikenga-artifact-builder` | artifact-builder skill | pnpm | **yes** (version-only) |

> Verify against the live org `CONTRIBUTING.md` table before quoting it — this copy
> exists for offline convenience and may lag.

## Commits — Conventional Commits

Format: `type(scope): summary`. Types: `feat`, `fix`, `docs`, `refactor`, `test`,
`chore`. Example: `fix(kernel): unregister dev pkg on Ctrl-C`. Imperative mood,
no trailing period, lowercase summary.

## Branch naming

Branch off `main`, named for the work: `fix/<slug>`, `feat/<slug>`, `docs/<slug>`.

## Changesets

Repos marked "yes" above use [Changesets](https://github.com/changesets/changesets).
Any PR that changes published behaviour must include one: run `pnpm changeset`,
pick patch/minor/major, write a one-line summary, and commit the generated
`.changeset/*.md`. Not required for docs-only or CI-only changes.

## Provenance

Inbound = outbound: opening a PR licenses the contribution under the project's
**Apache-2.0** terms. No CLA, no DCO sign-off.

## Issue / PR templates

Issue templates and the PR template come from the target repo's `.github/` (or the
org default at `ikenga-hq/.github` when the repo has none). Read the actual
template at draft time — don't assume the field-set.
