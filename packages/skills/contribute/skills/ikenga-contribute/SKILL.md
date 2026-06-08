---
name: ikenga-contribute
description: |
  Helps people contribute to Ikenga — draft a well-formed issue, run the full
  pull-request workflow (Conventional Commits + Changesets + tests), or onboard
  as a package author. It reads the project's own conventions and templates and
  fills them; it never invents its own rules.

  TRIGGER when the user wants to: file a bug or feature request against an
  Ikenga repo; open a PR following the project's commit/branch/changeset rules;
  or build + publish their first Ikenga package.

  DO NOT TRIGGER for unrelated git/GitHub work outside the Ikenga org, or for
  reviewing/merging PRs (that's a maintainer action, not a contributor one).
allowed-tools: Read, Bash, Glob, Grep, WebFetch, AskUserQuestion, Skill
---

# ikenga-contribute

The contributor's copilot for [Ikenga](https://ikenga.dev). Ikenga is a multi-repo,
Apache-2.0 project under [`github.com/Royalti-io`](https://github.com/Royalti-io).
This skill lowers the friction of three things contributors do, and **defers to the
project's own published conventions for everything** (see `lib/conventions.md`).

**This file is a router.** Pick the action that matches the request, load that file
under `actions/`, and follow it.

## Routing

| If the user wants to… | Load |
|---|---|
| Report a bug / request a feature / file any issue | [`actions/issue-draft.md`](actions/issue-draft.md) |
| Open a pull request the right way (commits, changeset, tests, PR body) | [`actions/pr-workflow.md`](actions/pr-workflow.md) |
| Build + publish their first package | [`actions/pkg-onboard.md`](actions/pkg-onboard.md) |

If the request spans two (e.g. "I fixed a bug, file the issue and open the PR"),
run `issue-draft` first, then `pr-workflow`, carrying the issue number forward.

## Two rules that apply to every action

1. **Consume conventions, never invent them.** The repo→package-manager map, commit
   format, branch naming, which repos need a changeset, and the issue/PR template
   field-sets all live in the project, not in this skill. `lib/conventions.md` is a
   cached pointer; when in doubt, read the live source it names
   ([`Royalti-io/.github/CONTRIBUTING.md`](https://github.com/Royalti-io/.github/blob/main/CONTRIBUTING.md)
   and the target repo's templates). Never tell a contributor a rule this skill
   made up.

2. **Confirm before anything outward-facing.** This skill drafts; the human sends.
   Never run `gh issue create`, `gh pr create`, `git push`, or any command that
   publishes — until you've shown the contributor the exact content and they've
   said go. Default to a dry-run preview.

## A note on `gh` and issue templates

`gh issue create --template <file>` only pre-fills the template **body as text** —
it does not render GitHub's interactive issue *forms* (dropdowns/checkboxes). So
the correct path (used by `issue-draft`) is: read the target repo's template
field-set, collect answers via `AskUserQuestion`, assemble a filled Markdown
**body**, and pass it with `gh issue create --body-file`. Never rely on `--web`
alone (it abandons the contributor at a blank form) and never submit unconfirmed.

## Scope

In scope: Ikenga repos under `Royalti-io`. Out of scope: merging/reviewing PRs,
anything outside the org, and CRUD on a running shell's data (that's the domain
pkgs' job). For deep package-authoring mechanics this skill delegates to the
`ikenga-pkg-builder` skill rather than reimplementing it.
