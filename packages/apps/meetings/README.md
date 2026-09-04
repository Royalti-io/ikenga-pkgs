# Meetings — `com.ikenga.meetings`

A meeting recorder and notetaker for the Ikenga shell. It records **both sides**
of a call from your own machine, transcribes locally by default, and gives you a
player with a synchronised transcript.

It joins nothing. There is no bot, no calendar integration, and no account —
it records what your computer is already playing plus your microphone, which on
a call is everyone.

## What it records

**Audio only.** No video, no screen.

Two sources, mixed and also kept separate:

| Source | What it is |
|---|---|
| System output monitor | The other participants — whatever your computer plays |
| Microphone | You |

Keeping them separate is what gives you speaker attribution without a speaker
model: the transcript labels turns **You** and **Them**. On a group call that
reads as "me vs everyone else", which is the honest limit of this approach.

## Transcription

Choose a backend on first run, changeable later:

| Backend | Where audio goes | Notes |
|---|---|---|
| **Local whisper** (default) | Nowhere | Downloaded on first use — a pinned, checksummed build plus a model size you pick. No compiler needed. |
| **OpenAI** | To OpenAI | Needs your API key. Faster and often more accurate; your audio leaves the machine. |
| **Shell engine** | Depends on the engine | Currently always unavailable: no shipped Ikenga engine accepts audio. It will light up on its own if one does. |

Roughly 1× realtime on CPU for the `small.en` model, so an hour of meeting takes
about an hour to transcribe locally. Pick a smaller model if that matters more
than accuracy.

## Summaries

The digest above each transcript is produced locally by a rule-based pass — it
is deliberately thin, and honest about being so.

A real summary is a **separate, explicit action per meeting**, because it sends
the whole transcript to OpenAI. It never happens on its own.

## Privacy, stated plainly

- Recordings and transcripts live in `~/.ikenga/media/meetings/` and in the
  shell's local database. Nothing is uploaded unless you choose a cloud backend.
- With a cloud backend selected, **audio leaves your machine to be transcribed**.
  The consent gate says which provider before you record.
- **Your OpenAI key is stored unencrypted** in
  `~/.ikenga/media/.meetings-stt/config.json` (mode 0600). Ikenga has no vault a
  pkg can reach yet — see the Limitations below. Set `OPENAI_API_KEY` in the
  environment instead if that matters to you; it takes precedence and nothing is
  written to disk.
- Deleting a meeting removes its rows and its media together.

**Recording other people is regulated.** Several jurisdictions require the
consent of every participant. The app cannot announce itself — it isn't in the
call — so telling people is on you. The consent gate asks you to confirm that
before the first recording.

## Requirements

- Linux with PulseAudio or PipeWire (`pipewire-pulse` is fine)
- `ffmpeg` and `ffprobe` on `PATH`
- Node 20+

macOS and Windows are not supported yet — capture is PulseAudio-specific and
upstream ships no whisper CLI for Apple.

## Limitations

Worth knowing before you rely on it:

- **Two-way attribution only.** Turns are labelled by audio channel, not by
  recognising voices, so a group call gives "You" and "Them", not names.
- **The API key is not encrypted at rest**, because no pkg can reach the shell's
  vault today. Use the environment variable if you need better.
- **Long meetings take a while locally.** There is no partial or streaming
  transcript yet; you get the whole thing when it finishes.
- **Linux only.**

## Troubleshooting

| Symptom | Cause |
|---|---|
| Recording won't start | `ffmpeg` missing, or no PulseAudio/PipeWire. Run preflight; it names what's absent. |
| Only your voice is recorded | Nothing was playing through the speakers, or your default output has no monitor source. |
| Transcription fails immediately | No backend configured, or whisper was never downloaded. Open the transcription settings. |
| A transcription was interrupted | The audio is still on disk. Use **↻ Transcribe** on the meeting; nothing is lost. |
