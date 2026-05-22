---
name: studio-doctor
description: Preflight the Studio toolchain — checks ffmpeg, a Chromium for HyperFrames, and bun (required), plus python3 + librosa (optional, music-video only). Warns rather than fails when an optional dependency is missing.
---

# studio-doctor

Toolchain preflight for `com.ikenga.studio`. Run it before `studio-init` / `studio-oneshot`.

## What it checks

| Dependency | Required? | Used by |
|------------|-----------|---------|
| `ffmpeg` | **required** | exporter (stitch/encode) |
| Chromium / Chrome | **required** | HyperFrames renderer (Puppeteer) |
| `bun` | **required** | sidecar / CLI runtime |
| `python3` | optional | `studio-beat-detect` |
| `librosa` (python import) | optional | `studio-beat-detect` (beat/onset detection) |

`python3` and `librosa` are **warn-not-fail**: only the music-video archetype needs beat detection. A box without them can still build the other six archetypes, so `studio-doctor` reports them as warnings and **exits 0**.

## Running

The skill invokes the bundled check script:

```
bash skills/studio-doctor/check.sh
```

It prints a table of `ok` / `MISSING` per dependency and a one-line summary. Exit code is `0` unless a **required** dependency is missing (then `1`). Missing optional deps never fail the check.

## Interpreting output

- All `ok` → you're clear to build anything, including music videos.
- `python3`/`librosa` `MISSING (optional)` → everything works except `studio-beat-detect`; install with `pip install librosa` when you need music-video beat-snapping.
