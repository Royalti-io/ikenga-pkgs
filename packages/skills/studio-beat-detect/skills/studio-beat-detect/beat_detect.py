#!/usr/bin/env python3
"""
studio-beat-detect — populate Project.audio_analysis.

Primary detector: librosa (beat_track + onset_detect).
Contingency: madmom (--detector madmom) — NOT a default dep; its build pins
Python <3.10 + numpy <1.20, so it's an opt-in from-source install only.

Output JSON matches AudioAnalysisSchema:
  {bpm, downbeats[], beats[], onsets[], source?, analysed_at?}   (arrays in ms)
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import wave
from datetime import datetime, timezone


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_ms(times_sec) -> list[int]:
    return [int(round(float(t) * 1000.0)) for t in times_sec]


def _downbeats_from_beats(beats_ms: list[int], meter: int) -> list[int]:
    # 4/4 default: every `meter`-th beat is a bar start.
    return [b for i, b in enumerate(beats_ms) if i % meter == 0]


def analyse_librosa(audio_path: str, meter: int) -> dict:
    import librosa  # raises ImportError if unavailable — caller handles

    y, sr = librosa.load(audio_path, sr=None, mono=True)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames")
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)

    beats_ms = _to_ms(beat_times)
    bpm = float(tempo) if not hasattr(tempo, "__len__") else float(tempo[0])
    return {
        "bpm": round(bpm, 2),
        "downbeats": _downbeats_from_beats(beats_ms, meter),
        "beats": beats_ms,
        "onsets": _to_ms(onset_times),
    }


def analyse_madmom(audio_path: str, meter: int) -> dict:
    # Contingency only. Imported lazily so absence never breaks the default path.
    from madmom.features.beats import RNNBeatProcessor, BeatTrackingProcessor  # type: ignore

    proc = BeatTrackingProcessor(fps=100)
    act = RNNBeatProcessor()(audio_path)
    beats_sec = proc(act)
    beats_ms = _to_ms(beats_sec)
    bpm = 0.0
    if len(beats_sec) > 1:
        avg = (beats_sec[-1] - beats_sec[0]) / (len(beats_sec) - 1)
        if avg > 0:
            bpm = 60.0 / avg
    return {
        "bpm": round(bpm, 2),
        "downbeats": _downbeats_from_beats(beats_ms, meter),
        "beats": beats_ms,
        "onsets": [],
    }


def _make_test_tone(path: str, bpm: int = 120, seconds: float = 4.0, sr: int = 22050) -> None:
    """Write a click track at `bpm` so beat_track has something unambiguous to find."""
    n = int(sr * seconds)
    period = sr * 60.0 / bpm  # samples per beat
    frames = bytearray()
    for i in range(n):
        # short decaying click at each beat boundary
        phase = i % period
        env = math.exp(-phase / (sr * 0.02)) if phase < sr * 0.05 else 0.0
        sample = int(env * 30000 * math.sin(2 * math.pi * 1000 * i / sr))
        sample = max(-32768, min(32767, sample))
        frames += int(sample).to_bytes(2, "little", signed=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(bytes(frames))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="studio-beat-detect")
    ap.add_argument("--audio", help="path to the audio track")
    ap.add_argument("--out", help="write analysis JSON here (default: stdout)")
    ap.add_argument("--detector", choices=["librosa", "madmom"], default="librosa")
    ap.add_argument("--meter", type=int, default=4, help="beats per bar (4/4 default)")
    ap.add_argument("--self-test", action="store_true",
                    help="fabricate a 120-bpm test tone and analyse it")
    args = ap.parse_args(argv)

    audio_path = args.audio
    tmp = None
    if args.self_test:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        _make_test_tone(tmp.name, bpm=120)
        audio_path = tmp.name

    if not audio_path:
        print("error: --audio is required (or use --self-test)", file=sys.stderr)
        return 2

    try:
        if args.detector == "madmom":
            result = analyse_madmom(audio_path, args.meter)
        else:
            result = analyse_librosa(audio_path, args.meter)
    except ImportError as e:
        print(
            f"error: detector '{args.detector}' unavailable ({e}). "
            "librosa is the primary detector — `pip install librosa`. "
            "madmom is contingency-only (pins Python <3.10).",
            file=sys.stderr,
        )
        return 3

    result["source"] = {"uri": args.audio} if args.audio else {"uri": "self-test://tone"}
    result["analysed_at"] = _now_iso()

    out_json = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf8") as f:
            f.write(out_json + "\n")
        print(f"wrote {args.out} (bpm={result['bpm']}, beats={len(result['beats'])})")
    else:
        print(out_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
