# action: pr-workflow — open a pull request the right way

Take a contributor from "I have a change" to "PR is open and passes the project's
bar," enforcing the project's own commit/branch/changeset/test conventions
(`lib/conventions.md`). The skill prepares and previews; the contributor authorizes
each outward step (`push`, `pr create`).

## What it does

1. **Locate the work.** Identify the repo (cwd git remote) and confirm it's an
   Ikenga repo under `Royalti-io`. Read `git status` / `git diff` to see what's
   changed. If the change is large or spans two unrelated concerns, suggest
   splitting into focused PRs.

2. **Branch.** If on `main`, create a branch off it named for the work:
   `fix/<slug>` / `feat/<slug>` / `docs/<slug>`. Never commit straight to `main`.

3. **Commit — Conventional Commits.** Compose `type(scope): summary` messages
   (`feat`/`fix`/`docs`/`refactor`/`test`/`chore`). If the contributor already
   committed with non-conventional messages, offer to help reword (interactive
   rebase is unavailable in this environment — guide them, or amend the latest).
   Stage deliberately; never `git add -A` a tree with unrelated dirty files.

4. **Changeset (if the repo needs one).** Check `lib/conventions.md` — if the repo
   uses Changesets and the change affects published behaviour, run `pnpm changeset`
   (pick patch/minor/major, write a one-line summary) and commit the generated
   `.changeset/*.md`. Skip for docs-only / CI-only changes, and for repos that
   don't use Changesets.

5. **Run the repo's checks.** Run the target repo's test/lint/typecheck with its
   package manager before pushing (e.g. `pnpm test` / `cargo test` /
   `bun run typecheck` — read the repo's `package.json`/README for the real script).
   Report results. Don't open a PR over red checks without flagging it.

6. **Fill the PR template.** Read the repo's `.github/PULL_REQUEST_TEMPLATE.md` (or
   the org default), fill Description / Linked Issues (`Closes #N`) / Type-of-Change
   / Checklist / screenshots-if-UI. Keep the template's structure.

7. **Preview + confirm, then push + open:**
   ```bash
   git push -u origin <branch>          # after confirm
   gh pr create -R Royalti-io/<repo> --base main --head <branch> \
     --title "<conventional title>" --body-file <filled-template>
   ```
   Show the title + body first; get explicit go for both the push and the PR. Print
   the PR URL.

## Notes

- One concern per PR. Review is a conversation — tell the contributor to expect
  questions and to push follow-ups to the same branch.
- If `gh` isn't authenticated, stop after the local commit + preview and hand over
  the exact `push` + `pr create` commands.
- Never force-push, never `git reset --hard`, never touch `.env*`.
