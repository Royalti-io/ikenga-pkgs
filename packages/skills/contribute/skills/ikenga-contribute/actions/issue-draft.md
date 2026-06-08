# action: issue-draft — file a well-formed issue

Draft a bug report or feature request that matches the target repo's template
**exactly**, so a maintainer can act on it without a round-trip. The skill drafts;
the contributor sends.

## What it does

1. **Pick the repo.** Ask which repo the issue is about (or infer from the cwd's
   git remote). Map it against `lib/conventions.md`. If the user is unsure what
   owns the problem, use the role column to help them choose.

2. **Pick the type.** Bug report or feature request? (Questions/ideas → route to
   [GitHub Discussions](https://github.com/orgs/Royalti-io/discussions) instead —
   don't open an issue.) Security problem? **Stop** — route to private reporting
   (`SECURITY.md`), never a public issue.

3. **Read the actual template field-set.** Fetch the target repo's template
   (`.github/ISSUE_TEMPLATE/bug_report.md` or `feature_request.md`); fall back to
   the org default at `Royalti-io/.github` if the repo has none. Parse the fields —
   do **not** assume them (templates drift). Use `gh api` or `WebFetch` on the raw
   file.

4. **Collect answers.** Walk the field-set with `AskUserQuestion` (one pass, grouped
   questions). For a **bug**, always gather: affected repo + version, OS +
   architecture, smallest reproduction, expected vs actual, and logs/screenshots if
   any. Run cheap fact-collection for the contributor where possible — e.g.
   `git -C <repo> describe --tags` or read the version from `package.json` /
   `Cargo.toml` / `tauri.conf.json`; capture `uname -a` for OS/arch — rather than
   asking them to look it up. For a **feature**, lead with the *problem*, then the
   proposed solution, then alternatives considered.

5. **Assemble the body.** Fill the template's Markdown structure with the answers,
   keeping its headings so it reads like a native submission. Apply the template's
   `title:` prefix (`[BUG] ` / `[FEAT] `) and `labels:`.

6. **Preview + confirm.** Show the full rendered issue (title, labels, body). Ask
   for explicit go. Edit on request.

7. **Submit only on confirmation:**
   ```bash
   gh issue create -R Royalti-io/<repo> \
     --title "<title>" --label "<labels>" --body-file <tmp>
   ```
   (`--body-file`, not `--web` — the `gh` CLI can't render YAML issue forms, so we
   ship a fully-filled Markdown body instead.) Print the issue URL.

## Notes

- One issue per problem. If the contributor describes three bugs, draft three.
- Don't fabricate reproduction steps — if they don't have a clean repro, say so in
  the body rather than inventing one.
- If `gh` isn't authenticated, stop at the preview and give the contributor the
  exact `gh issue create` command (or a `--web` link) to run themselves.
