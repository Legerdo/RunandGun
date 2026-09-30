"""Transcribe generated voice clips with faster-whisper to verify their content."""
from pathlib import Path
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
model = WhisperModel("base.en", device="cpu", compute_type="int8")
for f in sorted((ROOT / "public" / "voice").glob("*.mp3")):
    segs, _ = model.transcribe(str(f), beam_size=3, language="en")
    text = " ".join(s.text.strip() for s in segs)
    print(f"{f.stem:18s} -> {text}")
