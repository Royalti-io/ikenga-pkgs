# @ikenga/skill-contribute

The **`ikenga-contribute`** skill — a contributor's copilot for [Ikenga](https://ikenga.dev).

It helps people:

- **Draft a well-formed issue** — reads the target repo's actual template field-set, collects answers, and assembles a filled body (bug repro / env / version, or problem-first feature requests).
- **Run the full PR workflow** — branch naming, Conventional Commits, a Changesets reminder where the repo needs one, the repo's own tests, and a filled PR template.
- **Onboard as a package author** — orients on archetype, then delegates to `ikenga-pkg-builder` for the scaffold, plus the publish path.

Two invariants: it **consumes the project's published conventions** (never invents rules), and it **confirms before anything outward-facing** (it drafts; you send).

## Install

```bash
npx skills add royalti-io/ikenga-contribute
```

In a running Ikenga shell, install it from the Ọba catalog.

## Use

Invoke `/ikenga-contribute` and say what you want — file an issue, open a PR, or build a pkg. See the [contributing guide](https://ikenga.dev/docs/contributing) for the human-readable version of everything this skill automates.

## Layout

```
skills/ikenga-contribute/
├── SKILL.md                 router
├── lib/conventions.md       cached pointer to the project's rules
└── actions/
    ├── issue-draft.md
    ├── pr-workflow.md
    └── pkg-onboard.md
```

Apache-2.0.
