---
name: thunderbird-email
description: Read and search emails from local Thunderbird mail storage, and save reply drafts to the IMAP server. Use when agents need to access email data for financial workflows (payment receipts, billing notifications), editorial workflows (newsletter curation), or research workflows (industry intel), or to place a drafted reply into the user's Drafts folder for review. Triggers on email search, payment receipts, subscription notifications, newsletter extraction, or "save this as a draft / draft a reply in Thunderbird".
---

# Thunderbird Email Skill

Access the user's local Thunderbird mail store. Two capabilities:

1. **Read** (mbox) — search and extract emails from the local offline-store
   mbox files. Does not modify the store or sync IMAP.
2. **Write drafts** (IMAP APPEND) — place a drafted reply into the user's
   **Drafts** folder by appending it to the IMAP server (see
   [Writing drafts](#writing-drafts-imap-append)). This is the ONLY write path,
   and it goes to the server, never the local mbox. The skill does not send mail.

## Profile path

Set `TBIRD_PROFILE` to your Thunderbird profile directory. Defaults vary
by OS:

| OS | Default profile location |
|---|---|
| Linux (snap) | `~/snap/thunderbird/common/.thunderbird/<profile-id>.default` |
| Linux (apt) | `~/.thunderbird/<profile-id>.default-release` |
| macOS | `~/Library/Thunderbird/Profiles/<profile-id>.default-release` |
| Windows | `%APPDATA%\Thunderbird\Profiles\<profile-id>.default-release` |

Find your profile id by opening Thunderbird → **Help → Troubleshooting Information → Profile Folder**.

```bash
export TBIRD_PROFILE="$HOME/.thunderbird/abcd1234.default-release"
```

## Account map

Each IMAP account lives under `$TBIRD_PROFILE/ImapMail/<server-hostname>/`.
List your servers with:

```bash
ls "$TBIRD_PROFILE/ImapMail/"
```

A typical layout, given an account `you@example.com` hosted at
`mail.example.com`:

| File | Purpose |
|---|---|
| `$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX` | Top-level inbox mbox |
| `$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX.sbd/Sent` | Sent folder |
| `$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX.sbd/Drafts` | Drafts |
| `$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX.sbd/<Label>` | Custom labels (Thunderbird subfolders) |

The `.sbd` suffix is Thunderbird's mail-store-directory convention — INBOX
itself is an mbox file, while its subfolders live under `INBOX.sbd/`.

## File ordering

Thunderbird does NOT guarantee a fixed ordering inside mbox files. Different
servers/accounts may append at either end depending on IMAP sync direction
and history. When in doubt, parse the full file and sort by the `Date:`
header rather than relying on file order.

## Reading mbox files

Two paths:

### Option A — inline mbox parser (no deps)

Mbox files are concatenated emails separated by lines that start with
`From ` (note the trailing space, no colon). Walk lines, splitting at
each `From ` line, then RFC-822-parse each chunk.

```typescript
import { readFileSync } from 'node:fs';

interface ParsedEmail {
  message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  cc_address: string | null;
  subject: string | null;
  body_text: string;
  received_at: Date | null;
}

function parseMbox(path: string): ParsedEmail[] {
  const raw = readFileSync(path, 'utf8');
  const messages = raw.split(/^From .*$/m).filter(Boolean);
  return messages.map(parseRfc822);
}

function parseRfc822(chunk: string): ParsedEmail {
  const [headerBlock, ...bodyParts] = chunk.split(/\r?\n\r?\n/);
  const headers = parseHeaders(headerBlock);
  return {
    message_id: headers['message-id'] ?? null,
    from_address: headers['from'] ?? null,
    to_address: headers['to'] ?? null,
    cc_address: headers['cc'] ?? null,
    subject: decodeMimeHeader(headers['subject'] ?? ''),
    body_text: bodyParts.join('\n\n'),
    received_at: headers['date'] ? new Date(headers['date']) : null,
  };
}

function parseHeaders(block: string): Record<string, string> {
  const lines = block.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let lastKey: string | null = null;
  for (const line of lines) {
    if (/^[\t ]/.test(line) && lastKey) {
      // Continuation of previous header (RFC-822 folding).
      headers[lastKey] += ' ' + line.trim();
    } else {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) {
        lastKey = m[1].toLowerCase();
        headers[lastKey] = m[2];
      }
    }
  }
  return headers;
}
```

### Option B — `mbox` npm package

If you don't want to hand-roll the parser, [`node-mbox`](https://www.npmjs.com/package/node-mbox)
and similar packages handle the splitting and header parsing for you.
Trade-off: dependency vs. control.

## MIME header decoding

Subjects (and other headers) may be encoded:

```
Subject: =?UTF-8?Q?Payment=20of=204,500.00?=
Subject: =?UTF-8?B?8J+On++4jw==?=
```

The encoded-word format is `=?<charset>?<Q|B>?<encoded>?=`:

- `Q` → quoted-printable (`=20` → space, `=2C` → comma)
- `B` → base64 (decode with `Buffer.from(s, 'base64').toString(charset)`)

```typescript
function decodeMimeHeader(header: string): string {
  return header.replace(/=\?([^?]+)\?(Q|B)\?([^?]*)\?=/g, (_, charset, enc, payload) => {
    if (enc === 'B') return Buffer.from(payload, 'base64').toString(charset.toLowerCase());
    return payload.replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/_/g, ' ');
  });
}
```

## Quick CLI search

For one-off lookups without a parser:

```bash
# Search by sender (literal substring match on the From header)
grep -n "^From:.*example.com" "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX"

# Search by date
grep -n "^Date:.*29 Nov 2025" "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX"

# Search by subject (case-insensitive)
grep -in "^Subject:.*invoice" "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX"

# Extract email by line range, given a `grep -n` hit
sed -n '1234,1378p' "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX"
```

## Large mailbox handling

For mailboxes >100MB, extract a recent tail first:

```bash
tail -c 50000000 "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX" > /tmp/recent.mbox
grep -n "^From:.*example.com" /tmp/recent.mbox
```

The tail may start mid-message — discard everything before the first
`From ` line. For programmatic parsers, set a `chunkSize` (e.g. 5MB) and
stream rather than reading the whole file into memory.

## Storage downstream

If you persist parsed emails (for triage, history, audit), the parsed
shape maps cleanly onto a flat table:

```sql
CREATE TABLE email_messages (
  message_id TEXT PRIMARY KEY,
  from_address TEXT,
  to_address TEXT,
  cc_address TEXT,
  subject TEXT,
  body_text TEXT,
  received_at TIMESTAMPTZ,
  inbox_source TEXT,
  processed_at TIMESTAMPTZ DEFAULT now()
);
```

Wire to whatever DB you use (Postgres, SQLite, Supabase) via your normal
client. The fields above are stable across the parser implementations
shown.

## Error handling

### Lock file detection

Thunderbird locks mbox files while running. If a parse fails partway:

```bash
pgrep -x thunderbird >/dev/null && echo "Thunderbird is running"
```

If running, warn the user that the data may be stale or partially locked.
Retry once after ~30 seconds or fall back to a cached snapshot.

### Stale data

Check mbox mtime before relying on it:

```bash
stat -c %Y "$TBIRD_PROFILE/ImapMail/mail.example.com/INBOX"
```

If older than a few hours, IMAP may not have synced recently. Suggest the
user open Thunderbird to trigger a sync.

### Corrupted entries

If parsing throws on a specific chunk, skip it and continue — log the
count of skipped messages and surface it in the run summary.

### Encoding edge cases

| Symptom | Likely cause | Recovery |
|---|---|---|
| Garbled subject with `Ã©`, `Ã¼` | Double-encoded UTF-8 | Decode as latin1 first, then re-encode to UTF-8 |
| Empty `body_text` despite content | Truncated multipart boundary | Fall back to first 500 chars of raw body |
| `=?UNKNOWN?Q?...?=` in subject | Unrecognized charset in MIME header | Strip encoding wrapper, return raw ASCII |
| Raw base64 without `=?...?B?` wrapper | Non-standard MUA | Detect `^[A-Za-z0-9+/=]{20,}$`, attempt decode |

## Writing drafts (IMAP APPEND)

To place a reply/draft into Thunderbird's **Drafts** for the operator to review
and send, **APPEND it to the IMAP server** — do not write it into the local mbox.

### Why local mbox edits don't work

Drafts is an **IMAP** folder. Thunderbird displays it from the server's view,
indexed by the folder's `.msf` summary file. A message written directly into the
local offline-store mbox (`…/INBOX.sbd/Drafts`) has no server UID and no `.msf`
entry, so Thunderbird never shows it and **compaction deletes it**. The edit
appears to succeed (the bytes are in the file) but the draft never surfaces.

### The correct path

APPEND the raw RFC822 message to the server's Drafts mailbox with the `\Draft`
flag, using an IMAP client (e.g. `imapflow`):

```ts
const imap = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass } });
await imap.connect();
const boxes = await imap.list();
const drafts = boxes.find(
  m => m.specialUse === "\\Drafts" || /^(INBOX[./])?Drafts?$/i.test(m.path),
);
await imap.append(drafts.path, Buffer.from(rawRfc822, "utf8"), ["\\Draft", "\\Seen"], new Date());
await imap.logout();
```

`append()` returns the new `uid`; the draft syncs into Thunderbird on next sync.

### Credentials

The mailbox password is **not** in Thunderbird's mbox or a flat dotenv — resolve
it from your secret store. In Ikenga that's **Stronghold** via the `secrets-mcp`
binary (`getScopedSecrets(scope, ["…_HOST","…_PORT","…_USER","…_PASS"])`); the
first fetch is slow (~6 min cold vault open), so run with a long timeout.

### Threading a reply

Set, from the message being replied to:

- `In-Reply-To: <their-message-id>`
- `References: <prior chain…> <their-message-id>`
- `Subject: Re: <original subject>`

Build the body as a top-post: your reply, a blank line, an attribution line
(`On M/D/YYYY h:mm AM/PM, <Name> wrote:`), then the prior message `> `-quoted
(decode its quoted-printable body first). Use CRLF on the wire. Leave the local
mbox untouched.

## Limitations

- **Reading is read-only**; drafts can be written via IMAP APPEND (see [Writing drafts](#writing-drafts-imap-append)). This skill does not otherwise send, edit, or sync mail.
- **Sync-dependent.** Mbox freshness tracks Thunderbird's IMAP sync —
  not the live server.
- **Body parsing is shallow.** HTML emails surface as raw HTML in
  `body_text`; multipart attachments are not extracted.
- **No attachments.** Only headers + the text part of the body are
  returned by the parsers above. Extracting attachments requires
  decoding multipart boundaries fully.
