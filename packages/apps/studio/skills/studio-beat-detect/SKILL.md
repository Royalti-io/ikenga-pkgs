---
name: studio-beat-detect
description: Analyse a music-video project's audio track with python3 + librosa to populate Project.audio_analysis — bpm, downbeats, beats, and onsets in milliseconds — so the timeline can snap cell durations to the beat grid.
---

# studio-beat-detect

Populates `Project.audio_analysis` for the **music-video** archetype. The other six archetypes don't need it.

## What it does

Shells `python3` to run the bundled `beat_detect.py` over the project's audio track and writes:

```jsonc
{
  "bpm": 128.0,
  "downbeats": [0, 1875, 3750, ...],   // bar starts, ms
  "beats":     [0, 468, 937, ...],     // every beat, ms
  "onsets":    [12, 470, 940, ...],    // transient onsets, ms
  "source":    { "uri": "audio/track.wav" },
  "analysed_at": "2026-05-22T12:00:00Z"
}
```

This matches `AudioAnalysisSchema` exactly. The composition timeline snaps cell durations to bar/beat boundaries when this block is present (P2 consumes it; P1 just populates it).

## Detector

- **Primary: librosa** — `librosa.beat.beat_track` for bpm + beats, `librosa.onset.onset_detect` for onsets. Downbeats are derived by grouping beats into bars (4/4 assumed; configurable via `--meter`). Pip-installable on Python 3.11+.
- **Contingency: madmom** — higher downbeat accuracy, but its build **pins Python <3.10 and numpy <1.20**, so it is an opt-in from-source install, **never a default dependency**. `beat_detect.py` only uses madmom if `--detector madmom` is passed and the import succeeds.

## Running

```
python3 skills/studio-beat-detect/beat_detect.py --audio <track> --out audio_analysis.json
# or generate a 120-bpm test tone to smoke the script:
python3 skills/studio-beat-detect/beat_detect.py --self-test
```

If `librosa` is not importable, the script exits non-zero with a clear message; `studio-doctor` flags this case ahead of time as a warn-not-fail optional dependency.
