---
name: draft-piece
description: Draft a new content piece in the dock chat (the content screen "Add piece" key action). Confirmed creation is written by the pane/host path, not this skill.
domain: content
ux_mode: confirm
inputs_schema:
  type: object
  properties:
    title:
      type: string
      description: Working title for the content piece.
    type:
      type: string
      enum: ["blog", "newsletter", "social", "video"]
      description: Content type. Note — video pieces are tracking-only; no production actions run in this skill.
    channel:
      type: string
      description: "Publication channel (e.g. 'royalti.io', 'Listmonk', 'LinkedIn', 'X', 'YouTube')."
    stage:
      type: string
      enum: ["idea", "outline", "draft", "review", "scheduled"]
      description: Initial editorial stage. Defaults to 'idea' if omitted.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft New Content Piece

    Gather the fields for a new content piece in chat (D-02 — setup-in-chat
    pattern). Do NOT write to the database — the pane/host path writes the row
    after the operator confirms.

    ## Fields to collect (ask for any not supplied as inputs)

    1. **Title** — working title for the piece (pre-filled: {{title}} if provided)
    2. **Type** — content type: blog / newsletter / social / video
       (pre-filled: {{type}} if provided)
       Note: if type = video, remind the operator that this is TRACKING ONLY —
       video production belongs to com.ikenga.studio.
    3. **Channel** — publication channel:
       - blog → royalti.io (default)
       - newsletter → Listmonk (default)
       - social → LinkedIn / X / Instagram (ask which)
       - video → YouTube (default)
       (pre-filled from {{type}} default, or {{channel}} if provided)
    4. **Stage** — initial stage, default `idea`
       (pre-filled: {{stage}} if provided)
       Options: idea / outline / draft / review / scheduled
    5. **Assigned to** — owner: current operator or an agent slug
       (blog-writer / content-agent / cmo-agent / social-agent)
    6. **Publish date** — target publish date (ISO-8601 or natural language
       like "next Friday"); leave blank if TBD
    7. **Campaign** — optional campaign or series grouping (e.g. "Q2 launch",
       "Monthly digest")
    8. **Brief / notes** — optional one-paragraph brief or context for the piece

    ## Confirmation

    Present a draft piece summary in chat:

    ```
    NEW PIECE DRAFT
    Title:       <title>
    Type:        <type>
    Channel:     <channel>
    Stage:       <stage>
    Assigned to: <assigned_to>
    Publish:     <publish_date or TBD>
    Campaign:    <campaign or —>
    Brief:       <notes or —>
    ```

    Ask: "Confirm to create this piece, or edit any field."

    **Do NOT write to the database.** The pane/host path will write the row
    when the operator confirms via the `ux_mode: confirm` gate.
triggers:
  - kind: manual
depends_on:
  - skill-core
requires_capabilities:
  - chat
---

# action: draft-piece

> **WP-21a body.** The YAML frontmatter above is the action declaration
> (validates against `ActionFrontmatter`). This prose body is the operational
> guide.

## What this action does (intent)

Gathers the fields for a new content piece in a dock-chat conversation (D-02 —
setup-in-chat pattern). Presents a draft summary for the operator to confirm or
edit. The pane/host path writes the row after confirmation — this skill performs
zero DB writes.

This is the skill-layer companion to the content screen's **"Add piece" key action**
(`plans/atelier-design-system/parts/screens/content.md` §1 Key actions — "Click
`.kb-add` in kanban column → Opens piece-creation flow in dock chat").

## CRUD boundary (R4)

`draft-piece` does NOT call `host.dbExec`. It is purely a chat-driven field
collection and preview action. The actual `INSERT INTO content_calendar` (or
`content_pieces` when WP-21b's migration runs) is performed by:

1. The pane's `host.dbExec` call (when the operator clicks "Confirm" in the
   kanban `.kb-add` flow), OR
2. The shell-level piece-creation handler (when the `ux_mode: confirm` gate
   fires from the dock).

The skill surfaces the draft; the host commits it.

## No sqlite capability needed

`draft-piece` does NOT declare `sqlite` in `requires_capabilities` because it
makes no DB reads or writes. It collects data in chat and hands the draft to the
host. The only capability needed is `chat` (the dock chat conversation).

## Video pieces — tracking only (G-VIDEO-STACK, R23)

If the operator selects `type = video`, the action:
- Reminds the operator that video pieces are tracking-only in this skill.
- Proceeds to draft the piece with all standard fields (title, channel, stage,
  assigned_to, publish_date).
- Does NOT collect Remotion configuration, encoding settings, or YouTube metadata.
- The created row in `content_calendar` (or `content_pieces`) will have
  `type = 'video'` and serves as a pipeline tracking entry only.

Video production (rendering, encoding, publishing) belongs to `com.ikenga.studio`.

## No publish/send transport (R22)

`draft-piece` does not collect newsletter send configuration or social post
scheduling details — those belong to `skill-outbound`. The action drafts the
piece's editorial fields and stages it at the initial stage (`idea` by default).
The operator advances the piece through the pipeline via `pipeline-sweep` proposals.

## Design reference

`plans/atelier/designs/atelier-setup-chat-infer.html` and
`plans/atelier/designs/atelier-setup-chat-interview.html` (D-02) — the same
setup-in-chat surface pattern applies to piece drafting.

## Fields written (by the host, not this skill)

When the host commits the confirmed piece draft, it writes these base columns to
`content_calendar` (pre-0047 base columns only — no post-migration columns):

| Column | Source |
|---|---|
| `id` | Generated by host |
| `type` | Collected in chat |
| `channel` | Collected in chat |
| `title` | Collected in chat |
| `status` | Collected in chat (default: `idea`) |
| `assigned_to` | Collected in chat |
| `publish_date` | Collected in chat (nullable) |
| `campaign` | Collected in chat (nullable) |
| `created_at` | Set by host at INSERT time |

App-layer columns added by the WP-21b migration (`next_action`, `next_action_mode`,
`series_name`, `series_part`) are not set by this skill — the pane populates
them per its own logic after the base row is created.
