# action: `issue-sync` — track WPs using native Git issues

**Loaded when**: the user says "groundwork issue-sync", "sync git issues", "export WPs to issues", "pull issue status", or passes `--create-issues` to `orchestrate`.

**Reads first**: `../lib/state.md`, `.groundwork.json`, `05-tracking.md`, `09-orchestration.md`.

**Spine-version**: `expected = "1"`. Runs [`../lib/state.md` §"Spine-version preamble gate"](../lib/state.md#spine-version-preamble-gate) before modifying state.

---

## What `issue-sync` does

Maps each Work Package (`WP-NN`) 1:1 to a native Git Issue on GitHub or GitLab using provider CLI wrappers (`gh` / `glab`).

### Modes

1. **`--export`**: Provisions new Git issues for all `WP-NN` items currently lacking an issue mapping in `.groundwork.json`.
2. **`--pull` / default `issue-sync`**: Performs timestamped bi-directional status synchronization (Strategy C: last-updated wins).
3. **`--link`**: Interactively links an existing Git issue number to a `WP-NN`.

---

## Execution Protocol

### Step 1: Read Plan Issue Model

Run the state executor to get the current WP issue dataset:

```bash
python3 <skill>/scripts/groundwork_state.py issue-sync-data --plan <plan>
```

Parses JSON stdout returning `wps` array with fields: `id`, `title`, `status`, `wave`, `tier`, `brief`, `issue` (`provider`, `number`, `url`, `last_synced`), `updated_at`.

### Step 2: Detect Git Forge Provider

Run `git remote -v` in the workspace:
- If remote points to `github.com` (or enterprise GitHub): provider is `github`, CLI tool is `gh`.
- If remote points to `gitlab.com` (or self-hosted GitLab): provider is `gitlab`, CLI tool is `glab`.
- Fallback: Default to `gh`. If `gh` or `glab` CLI is not installed/authenticated, report warning and skip remote sync.

---

### Step 3: Export Unlinked WPs (`--export`)

For each WP where `issue` is `null`:

1. **Build Title**: `[<WP-ID>] <title>` (e.g. `[WP-01] Canvas extraction`).
2. **Build Body**:
   ```markdown
   ## <WP-ID>: <title>
   **Plan**: <plan_slug> | **Wave**: <wave> | **Tier**: <tier>

   ### Brief & Definition of Done
   <brief>

   ---
   *Tracked by groundwork plan `<plan_slug>`*
   ```
3. **Invoke Forge CLI**:
   - **GitHub**:
     ```bash
     gh issue create --title "[WP-01] Canvas extraction" --body "..." --label "groundwork"
     ```
   - **GitLab**:
     ```bash
     glab issue create --title "[WP-01] Canvas extraction" --description "..." --label "groundwork"
     ```
4. **Register in State Anchor**:
   Parse issue number and URL from command output, then register:
   ```bash
   python3 <skill>/scripts/groundwork_state.py register-issue --plan <plan> --id <WP-ID> --number <NUM> --url <URL> --provider <github|gitlab>
   ```

---

### Step 4: Bi-directional Sync (`--pull` / Strategy C)

Fetch remote issue statuses:

```bash
# GitHub
gh issue list --label "groundwork" --json number,state,updatedAt,url --limit 100

# GitLab
glab issue list --label "groundwork" --output json
```

For each linked WP:

1. **Compare Timestamps (`updated_at` vs remote `updatedAt`)**:
   - **Remote newer & Issue CLOSED**: If remote status is `CLOSED` (or `closed`) and local status is `queued` or `in_progress`, set local status to `done`.
   - **Remote newer & Issue OPEN**: If local status is `done` but issue was re-opened remotely, set local status to `in_progress`.
   - **Local newer & WP `done`**: If local WP status was flipped to `done` (e.g. via PR merge or manual edit) after issue `last_synced`, close remote issue:
     ```bash
     gh issue close <NUM> --comment "Closed by groundwork issue-sync (WP completed locally)."
     ```
   - **Local newer & WP `in_progress`/`queued`**: If local status re-opened, re-open remote issue:
     ```bash
     gh issue reopen <NUM>
     ```

2. **Apply Updates**:
   Write update payload to a temp file `/tmp/gw-issue-updates.json`:
   ```json
   {
     "issue_registrations": [],
     "status_updates": [
       { "id": "WP-01", "status": "done" }
     ]
   }
   ```
   Apply updates back to `.groundwork.json`:
   ```bash
   python3 <skill>/scripts/groundwork_state.py apply-issue-sync --plan <plan> --updates-file /tmp/gw-issue-updates.json
   ```

---

## Click-to-fire prompt

```
/groundwork issue-sync {plan_folder}
```

**Seeded-session form**:
> Sync Git forge issues for `{plan_folder}`. Detect `gh` or `glab` CLI, provision missing issues for unlinked WPs, perform timestamped status sync, and update `.groundwork.json`.
