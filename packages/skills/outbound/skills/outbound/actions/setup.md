---
name: setup
description: Configure skill-outbound for the current project — channel identities (royalti.io = Listmonk/SMTP; getroyalti.com = Resend cold-outreach only; social creds presence check). Writes .atelier/skill-outbound/manifest.json.
domain: skill-core
ux_mode: streaming
run:
  kind: chat_prompt
  prompt: |
    # Outbound Setup

    Walk the operator through configuring the outbound skill channel identities.
    This is an interview-mode setup (D-02) — ask each question in chat and
    confirm before writing.

    Interview questions (in order):

    1. **Listmonk / SMTP identity** (royalti.io newsletters + transactional sequences):
       - Confirm from_name and from_email for royalti.io outbound.
       - Default: from_name="Royalti", from_email="hello@royalti.io"

    2. **Resend cold-outreach identity** (getroyalti.com — cold-outreach ONLY):
       - Confirm from_name and from_email for cold-outreach.
       - Default: from_name="Royalti", from_email="hello@getroyalti.com"
       - Remind the operator: getroyalti.com via Resend is COLD-OUTREACH ONLY —
         never used for replies (that belongs to skill-mail / skill-pa).

    3. **Social channel credentials** — check Stronghold vault for OAuth token
       presence (use `secrets` capability; do NOT read the tokens themselves):
       - LinkedIn: connected? (yes/no)
       - X (Twitter): connected? (yes/no)
       - Buffer: connected? (yes/no)
       - If any are disconnected, note them as "not connected" in the config;
         instruct the operator to connect them via the outbound pane settings.

    4. **Quality threshold** — minimum quality score (0–100) before `send` flags
       a newsletter draft. Default: 75.

    5. **Cooling period** — minimum minutes between newsletter sends to the same
       list. Default: 60.

    On operator confirmation of all values, write
    .atelier/skill-outbound/manifest.json with template_version: 1.
    Do NOT clobber an existing file — detect older template_version and run the
    migrate path forward instead (preserve operator-set settings).
    After writing, dispatch the shell event skill.setup.complete with payload
    { skill: "skill-outbound", template_version: 1 } so the outbound pane
    re-renders with the newly configured channel identities.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - fs
  - chat
  - secrets
setup:
  mode: interview
  template_version: 1
  interview_questions:
    - listmonk_smtp_identity
    - resend_cold_outreach_identity
    - social_creds_presence
    - quality_threshold
    - cooling_period_minutes
---

# action: setup

The `setup` lifecycle action for skill-outbound. It is the reserved, well-known
`setup` verb (`name: setup`, so the `setup` block is required and `domain` is
`skill-core` — the generic identity domain, per worked example B in
`06-skill-action-contract.md` §8). It declares no `inputs_schema` (the adapter
falls back to the empty-object JSON-Schema). Optional — skill-outbound functions
with defaults if setup has not been run. When run, it:

1. Walks the operator through five interview questions **in chat** (D-02 — not
   a form).
2. Probes the Stronghold vault for social OAuth token presence (reads presence
   flag only — never the token value).
3. Writes (or migrates) `${CLAUDE_PROJECT_DIR}/.atelier/skill-outbound/manifest.json`.
4. Dispatches `skill.setup.complete` so the outbound pane re-renders.

**Instance file shape** (see `lib/state.md` §Channel-identity-config):

```json
{
  "skill": "skill-outbound",
  "template_version": 1,
  "configured_at": "<ISO-8601>",
  "settings": {
    "send_identities": [
      {
        "domain": "royalti.io",
        "delivery_system": "listmonk",
        "from_name": "Royalti",
        "from_email": "hello@royalti.io",
        "note": "newsletter + transactional sequences"
      },
      {
        "domain": "royalti.io",
        "delivery_system": "smtp",
        "from_name": "Chinedum Okerengwor",
        "from_email": "hello@royalti.io",
        "note": "direct outbound email"
      },
      {
        "domain": "getroyalti.com",
        "delivery_system": "resend",
        "from_name": "Royalti",
        "from_email": "hello@getroyalti.com",
        "note": "cold-outreach ONLY — never reply path"
      }
    ],
    "social_creds": {
      "linkedin": { "connected": false },
      "x": { "connected": false },
      "buffer": { "connected": false }
    },
    "quality_threshold": 75,
    "cooling_period_minutes": 60
  }
}
```

**Send-identity rules (config only — no sends happen here):**
- `royalti.io` → Listmonk for newsletter broadcasts; SMTP for direct outbound.
- `getroyalti.com` → Resend for cold-outreach ONLY (never reply path).
- Social creds: presence flag only — OAuth tokens live in Stronghold vault.

**Capabilities:**
- `fs` — writes the `.atelier/skill-outbound/manifest.json` instance file.
- `chat` — the confirm-in-chat interview conversation (D-02).
- `secrets` — probes the Stronghold vault for social OAuth token presence. Does
  NOT read or store token values.

**No DB reads or writes.** `setup` is purely a project-config action.

**setup-in-chat surface (D-02):** When invoked, the dock chat stream forks into
the setup-in-chat conversation pattern. The dock body's `.chat-stream` is replaced
by the setup interview — Chi walks through the five interview questions. On
"Confirm & localize" the config is written to
`.atelier/skill-outbound/manifest.json` and the `skill.setup.complete` event is
dispatched, returning the dock to the standard Chi chat stream.

**WP-17a precedent:** This setup pattern (interview mode + Stronghold presence
check + `.atelier/<skill>/manifest.json` write) follows the same shape as
`skill-mail setup` (WP-17a). The only difference is `mode: interview` (vs.
`ai_infer` for mail) because channel identity configuration requires explicit
operator input for each channel rather than AI inference from project files.
