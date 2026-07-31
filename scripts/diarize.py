#!/usr/bin/env python3
"""Speaker diarization using pyannote-audio.

Takes a WAV file path, outputs speaker segments as JSON to stdout.
Called from TypeScript via execFile — not imported as a module.

Usage:
    python scripts/diarize.py <wav-file> [--min-speakers N] [--max-speakers N]

Output (JSON to stdout):
    {"segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 45.3}, ...]}
"""

import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Speaker diarization")
    parser.add_argument("wav_file", help="Path to WAV file (16kHz mono)")
    parser.add_argument("--min-speakers", type=int, default=None)
    parser.add_argument("--max-speakers", type=int, default=None)
    args = parser.parse_args()

    if not os.path.isfile(args.wav_file):
        print(f"File not found: {args.wav_file}", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("HF_TOKEN"):
        print("HF_TOKEN environment variable not set", file=sys.stderr)
        sys.exit(1)

    try:
        from pyannote.audio import Pipeline
    except ImportError:
        print("pyannote.audio not installed", file=sys.stderr)
        sys.exit(1)

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
        )
    except Exception as e:
        print(f"Failed to load diarization model: {e}", file=sys.stderr)
        sys.exit(1)

    # Use MPS (Metal) if available, fall back to CPU
    try:
        import torch

        if torch.backends.mps.is_available():
            pipeline.to(torch.device("mps"))
    except Exception:
        pass  # CPU fallback is fine

    # Run diarization
    kwargs = {}
    if args.min_speakers is not None:
        kwargs["min_speakers"] = args.min_speakers
    if args.max_speakers is not None:
        kwargs["max_speakers"] = args.max_speakers

    try:
        result = pipeline(args.wav_file, **kwargs)
    except Exception as e:
        print(f"Diarization failed: {e}", file=sys.stderr)
        sys.exit(1)

    # pyannote 4.x returns DiarizeOutput; extract the Annotation
    diarization = getattr(result, "speaker_diarization", result)

    # Convert to JSON-serializable segments
    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "speaker": speaker,
                "start": round(turn.start, 2),
                "end": round(turn.end, 2),
            }
        )

    json.dump({"segments": segments}, sys.stdout)


if __name__ == "__main__":
    main()
