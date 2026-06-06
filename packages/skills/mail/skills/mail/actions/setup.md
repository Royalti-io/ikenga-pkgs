---
name: setup
description: Configure skill-mail for the current project (inbox source, send identity, triage buckets). Writes .atelier/skill-mail/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Mail Setup

    Infer the project's mail configuration from context (infer_sources: package.json,
    README.md, .atelier/skill-mail/manifest.json if present). Draft candidate settings:

    - inbox_sources: which IMAP labels / folders to read (default: ["INBOX"])
    - send_identities: per-domain send config:
        - royalti.io → delivery_system: smtp (transactional + replies)
        - getroyalti.com → delivery_system: resend (cold-outreach ONLY)
    - triage_buckets: bucket labels for triage-inbox (default: ["reply-now", "delegate", "archive"])
    - default_signature: appended to drafted replies

    Present each setting for operator confirmation IN CHAT (D-02 — not a form screen).
    On confirmation, write .atelier/skill-mail/manifest.json with template_version: 1.
    Do NOT clobber an existing file — detect older template_version and run the migrate
    path forward instead (preserve operator-set settings).
    After writing, dispatch the shell event skill.setup.complete with payload
    { skill: "skill-mail", template_version: 1 } so the mail pane re-renders.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - fs
  - chat
setup:
  mode: ai_infer
  template_version: 1
  infer_sources:
    - "package.json"
    - "README.md"
    - ".atelier/skill-mail/manifest.json"
---

# action: setup

The `setup` lifecycle action for skill-mail. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8). It declares no `inputs_schema` (the adapter
falls back to the empty-object JSON-Schema). Optional — skill-mail functions
with defaults if setup has not been run. When run, it:

1. Reads `infer_sources` to draft candidate config (inbox sources, send identities).
2. Presents each setting for operator confirmation **in chat** (D-02 — not a form).
3. Writes (or migrates) `${CLAUDE_PROJECT_DIR}/.atelier/skill-mail/manifest.json`.
4. Dispatches `skill.setup.complete` so the mail pane re-renders.

**Instance file shape** (see `lib/state.md` §Inbox-source + send-identity config):

```json
{
  "skill": "skill-mail",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "inbox_sources": ["royalti.io/INBOX"],
    "send_identities": [
      {
        "domain": "royalti.io",
        "delivery_system": "smtp",
        "from_name": "Chinedum Okerengwor",
        "from_email": "hello@royalti.io"
      },
      {
        "domain": "getroyalti.com",
        "delivery_system": "resend",
        "from_name": "Royalti",
        "from_email": "hello@getroyalti.com",
        "note": "cold-outreach only"
      }
    ],
    "triage_buckets": ["reply-now", "delegate", "archive"],
    "default_signature": "— sent from Ikenga"
  }
}
```

**Send-identity rules (config only — no sends happen here):**
- `royalti.io` → Listmonk/SMTP for transactional replies.
- `getroyalti.com` → Resend for cold-outreach ONLY (never reply path).

**Capabilities:**
- `fs` — writes the `.atelier/skill-mail/manifest.json` instance file.
- `chat` — the confirm-in-chat conversation (D-02). No `sqlite` needed — setup
  does not read `ikenga.db`.

**No DB reads or writes.** `setup` is purely a project-config action.

**setup-in-chat surface (D-02):** When invoked, the dock chat stream forks into
the setup-in-chat conversation pattern. The dock body's `.chat-stream` is replaced
by the setup conversation — Chi infers or interviews for skill-mail config. On
"Confirm & localize" the config is written to `.atelier/skill-mail/manifest.json`
and the `skill.setup.complete` event is dispatched, returning the dock to the
standard Chi chat stream.
