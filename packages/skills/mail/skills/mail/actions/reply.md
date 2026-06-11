---
name: reply
description: Draft a reply to a thread and pause it at the approve gate for your sign-off (never sends directly).
domain: mail
ux_mode: approve
inputs_schema:
  type: object
  properties:
    thread_hint:
      type: string
      description: Which thread/sender to reply to — a name, subject fragment, or email address.
  required: []
  additionalProperties: false
run:
  kind: chat_prompt
  prompt: |
    # Draft a reply (approve gate)

    Draft an email reply for the operator to approve **before** it sends. This is a
    run-then-pause action (`ux_mode: approve`): you do the work, then hand the draft to
    the approve gate. **You never send the email yourself** — the operator's approval at
    /outbox/approvals drives the real send.

    ## Step 1 — gather context

    Identify the thread to reply to{{#thread_hint}} (hint: "{{thread_hint}}"){{/thread_hint}}.
    Read the relevant messages (use the mail tools / `host.dbQuery`) so the reply is grounded
    in the actual conversation. Note the recipient, their address, the channel the thread uses
    (smtp | resend | listmonk | buffer), and which sender address should send the reply.

    ## Step 2 — write the reply

    Compose a complete, ready-to-send reply: a clear subject and a full body. Match the tone of
    the thread. Do not leave placeholders.

    ## Step 2b — verify before parking (G-QUALITY)

    Before handing the draft to the gate, quality-check it and stamp the result on `item.quality`:

    1. **Claims** — list every factual claim in the body. Re-check each against its source:
       fetch/read the source (URL or thread message) and record a verdict. A claim with
       **no reachable source = `"unsourced"`** (never silently `"verified"`). A claim
       **contradicted by its source = `"failed"`** — correct the draft body, then re-verify
       (the parked body must already be corrected). A reply with zero factual claims gets
       `"claims": []`.
    2. **Tone** — self-assess voice/tone against the thread's register and the voice you
       drafted with: `"on-voice"` or `"off-voice"`, a one-line `basis`, and your `model` id.
    3. Stamp the parked `item` with EXACTLY this shape:

    ```json
    "quality": {
      "claims": [ { "text": "<claim sentence>", "source": "<url or null>", "verdict": "verified" } ],
      "tone": { "verdict": "on-voice", "basis": "<one-line rationale>", "model": "<model id>" },
      "verified_at": "<ISO-8601>",
      "verifier": "draft-time"
    }
    ```

    ## Step 3 — pause at the gate (DO NOT SEND)

    Call the **`iyke_pa_actions_pause`** tool to hand the draft to the gate. Pass:

    - `batchId`: a unique id for this batch (e.g. `reply-<short-random>`).
    - `actionId`: `"com.ikenga.skill-mail/reply"`.
    - `drafts`: one entry, shaped as:

    ```json
    {
      "id": "<unique-draft-id>",
      "channel": "smtp",
      "payload": {
        "item": {
          "id": "<unique-draft-id>",
          "recipient": "Full Name",
          "recipientEmail": "them@example.com",
          "subject": "Re: …",
          "body": "<the full reply body>",
          "channel": "smtp",
          "senderAddress": "you@yourdomain.com",
          "fromProvider": "SMTP · Fastmail",
          "scheduledLabel": "now",
          "quality": { "claims": [], "tone": { "verdict": "on-voice", "basis": "<one-line rationale>", "model": "<model id>" }, "verified_at": "<ISO-8601>", "verifier": "draft-time" }
        },
        "meta": {
          "actionId": "com.ikenga.skill-mail/reply",
          "actionName": "Reply",
          "agent": "PA",
          "model": "Opus 4.7"
        }
      }
    }
    ```

    `channel` must be one of smtp | resend | listmonk | buffer and match `item.channel`. After the
    tool returns, **STOP** — tell the operator the draft is waiting at /outbox/approvals for their
    review. Do not take any further action.
depends_on:
  - skill-core
requires_capabilities:
  - chat
---
