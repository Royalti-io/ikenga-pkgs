---
"@ikenga/skill-contribute": minor
---

Initial release of `@ikenga/skill-contribute` (the `ikenga-contribute` skill) —
a contributor's copilot for Ikenga (plans/contribute · WP-10).

Router + three actions, all of which **consume the project's published
conventions** (repo→package-manager map, Conventional Commits, branch naming,
Changesets, issue/PR template field-sets) rather than inventing rules, and
**confirm before any outward-facing action** (the skill drafts; the contributor
sends):

- `issue-draft` — reads the target repo's actual issue-template field-set (falling
  back to the org default at `ikenga-hq/.github`), collects answers via
  `AskUserQuestion` (auto-gathering env/version/OS for bugs), assembles a filled
  Markdown body, previews it, and submits via `gh issue create --body-file` only on
  confirmation. Uses `--body-file` rather than `--web` because the `gh` CLI cannot
  render YAML issue forms.
- `pr-workflow` — branch off `main` with the project's naming, Conventional Commit
  messages, a Changesets reminder for the repos that need one, runs the repo's own
  tests, fills the PR template, and pushes + opens the PR only on confirmation.
- `pkg-onboard` — orients the author on archetype, then delegates the scaffold to
  the `ikenga-pkg-builder` skill (does not reimplement it), and lays out the
  publish path.

Manifest: `id: "com.ikenga.skill-contribute"`, `kind: "skill"`,
`permissions["shell.execute"]: ["git","gh","pnpm","bun","npx"]`,
`requires: [{kind:"skill", name:"skill-core"}]`. Marked `"private": true` until
the publish WP (WP-11) runs the mirror + catalog step.
