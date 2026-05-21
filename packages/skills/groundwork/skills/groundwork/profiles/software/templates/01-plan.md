<!-- GENERATED — edit .claude/skills/groundwork/ instead. Synced by sync-from-dev.mjs. -->
# {{goal}}

## Goal

<!-- groundwork:auto:start goal -->
<!-- last_action: init · {{date}} -->
{{goal}}
<!-- groundwork:auto:end goal -->

## Context

_Why now, what changed, what's at stake._

## Architecture

_The shape of the solution at one zoom-out level. How the major pieces fit together; which surfaces depend on which contracts. Annotate sections that were locked by a specific round: `## Architecture (locked Round N)` — future readers see provenance._

### Shared state contract

_The cross-component state that two or more pieces of the system must agree on. List every shared value with its type + which component writes it + which components read it. This is the thing that breaks if you change it without coordinating — make it explicit, in one place._

| Field | Type | Writer | Readers |
|---|---|---|---|
| | | | |

## Phases

> **Detail scales with proximity.** Current phase is fully detailed (concrete paths, tasks, risks). Next phase is sketched (scope + key open questions). Later phases are stubbed (one paragraph each). Use `(sketch)` / `(stub)` annotations on phase headers so the contract is explicit.

### Phase 1 — _title_

_Detailed. What's actually being built first, with concrete file paths + tasks._

### Phase 2 — _title_ (sketch)

_Sketched. Scope + key questions to resolve before this phase opens._

### Phase 3 — _title_ (stub)

_Stub. One paragraph of intent._

## Schema / contract

_The Zod (or equivalent) schema this work pivots on. The freeze gate that gates everything downstream. If a `drafts/schema.ts` exists, reference it here — it's what the build will copy._

## Critical files

_Repo-relative file paths the build will touch. The orchestrate action uses these to enforce intra-repo disjoint scopes. Group by repo if the work crosses multiple._

### `<repo>/`

- `path/to/file.ts` — what we'll do with it (create / extend / delete)
- …

## Reuse map — what we lift, reimplement, or drop

_For any non-trivial software project that integrates with existing code. The explicit "we built this fresh / we copied that / we delegated there / we deleted that" table. Lifts go in `drafts/` with the standard header; built-fresh goes in `05-tracking.md` as a WP; deletes are a WP too._

| Concern | Strategy | Source / target | Notes |
|---|---|---|---|
| _e.g._ Schema | **Lift** | from `pkgs/_review/<x>/.../schema.ts` → `drafts/schema.ts` → consumer WP-NN | byte-identical with `<other source>`; renamed `Beat → Cell` at the boundary |
| _e.g._ Canvas primitive | **Extract** | from `shell/src/shell/home/home.tsx` → `contract/src/canvas/` | gates WP-NN; see `06-canvas-extraction.md` diff plan |
| _e.g._ Adapter A | **Build fresh** | `WP-NN` ships `path/to/adapter.ts` | depends on contract WP-NN |
| _e.g._ Library X | **Net-zero-fork** | npm-depend `@org/x@version`; integrate via the public surface | upstream stability check: `<source>` |
| _e.g._ Legacy viewer | **Drop** | `path/to/old-viewer.tsx` removed in WP-NN | nothing depends on it; verified by grep |

### Upstream library posture

_If integrating with multiple libraries, document the per-library strategy. Studio's "net zero forks" policy is a useful default — never fork an upstream; integrate via published API surfaces or peer sidecars._

## Renderer / adapter contracts

_Trait / interface definitions for any pluggable seam. Each must lock before its consumers start (`G-ADAPTER`-style gate). Annotate with `(locked Round N)` when frozen._

## Risks + alternatives

_What could go wrong, what was considered and rejected. The review action augments this section as Rounds surface new risks; the original entries stay._

## ID registry

The full ID registry is in `.groundwork.json.ids`. Local cross-reference index:

<!-- groundwork:auto:start ids -->
<!-- last_action: init · {{date}} -->
_No IDs allocated yet. The review action populates this index._
<!-- groundwork:auto:end ids -->

## Verification

_Per-phase ship gates — concrete, runnable checks. Each item must be observable (a passing test, a green typecheck, a manual screenshot diff, a user-confirmed signal). "Stakeholders are happy" is not a verification item; "DSP smoke test renders the fixture in <10s on a dev box" is._

### Phase 1 verification

1. _e.g._ `pnpm typecheck` green across all touched repos
2. _e.g._ Smoke fixture renders end-to-end
3. _…_

### Phase 2 verification (sketch)

1. _…_
