"""Generate voice lines with Fish Audio TTS, then trim/normalize them with ffmpeg.

usage:  $env:FISH_API_KEY = "..." ; python tools/gen_voices.py [--force] [name ...]
The API key is read from the environment only (never written to disk).
Raw responses go to art/voice_raw/, processed clips to public/voice/.
"""
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "voice_raw"
OUT = ROOT / "public" / "voice"
RAW.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# Generic (non-celebrity) community voices chosen for their tags.
ANNOUNCER = "4c6a6762e4ac4bdebdb4fa8525d054a2"  # "ATOMIC": deep, energetic, dramatic announcer
HERO = "e9b134e4c0b547a3894793be502314f1"  # "Jasphina": energetic, playful, expressive female
GRUNT = "0f86952cc3a64452b352427021f357d9"  # "Drill Sargent": angry, dramatic male
ADMIRAL = "4d78f878f023424cb77975a6dea180a6"  # "Pirate": raspy, dramatic, authoritative
WORKER = "31088114f4114db98de61c41c2f163db"  # warm, jolly old man

# name: (voice, text, speed)
LINES = {
    "mission_start": (ANNOUNCER, "[excited] [shouting] Mission... start!", 1.0),
    "mission_complete": (ANNOUNCER, "[excited] [shouting] Mission complete!", 1.0),
    "w_gatling": (ANNOUNCER, "[shouting] Chain gun!", 1.0),
    "w_scatter": (ANNOUNCER, "[shouting] Scatter cannon!", 1.0),
    "w_rocket": (ANNOUNCER, "[shouting] Rocket launcher!", 1.0),
    "w_flame": (ANNOUNCER, "[excited] Flame... thrower!", 1.0),
    "bombs": (ANNOUNCER, "[shouting] Bombs!", 1.0),
    "warning": (ANNOUNCER, "[serious] [shouting] Warning! A huge enemy is approaching!", 1.0),
    "continue": (ANNOUNCER, "[serious] Continue?", 1.0),
    "gameover": (ANNOUNCER, "[serious] Game over.", 0.95),
    "tank": (ANNOUNCER, "[shouting] Tank incoming!", 1.0),
    "hero_die": (HERO, "[screaming] [shouting] Nooooo!", 0.9),
    "hero_train": (HERO, "[excited] [shouting] Hang on tight!", 1.0),
    "hero_win": (HERO, "[excited] [laughing] Ha! Harbor's clear. Drinks are on me!", 1.0),
    "thanks": (WORKER, "[grateful] [excited] Thank you!", 1.05),
    "boss_intro": (ADMIRAL, "[angry] [shouting] Who dares trespass in my harbor? Crush them, Barnacle King!", 1.0),
    "boss_hurt": (ADMIRAL, "[shocked] [shouting] My beautiful claw!", 1.0),
    "boss_rage": (ADMIRAL, "[angry] [screaming] Enough! Full power!", 1.0),
    "boss_die": (ADMIRAL, "[screaming] Curse you... rivet rat!", 1.0),
    "enemy_die_1": (GRUNT, "[screaming] Waaaagh!", 1.0),
    "enemy_die_2": (GRUNT, "[screaming] Aaaargh!", 1.0),
    "enemy_die_3": (GRUNT, "[screaming] Nooooo!", 1.0),
}


def tts(name: str, voice: str, text: str, speed: float) -> Path:
    key = os.environ.get("FISH_API_KEY")
    if not key:
        sys.exit("FISH_API_KEY is not set")
    body = {
        "text": text,
        "reference_id": voice,
        "format": "mp3",
        "mp3_bitrate": 128,
        "normalize": True,
        "latency": "normal",
        "temperature": 0.8,
        "prosody": {"speed": speed, "volume": 0},
    }
    req = urllib.request.Request(
        "https://api.fish.audio/v1/tts",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "model": "s2.1-pro-free"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    out = RAW / f"{name}.mp3"
    out.write_bytes(data)
    return out


def finish(raw: Path, name: str) -> None:
    # trim silence at both ends, gentle compression, loudness normalize, short fades
    af = (
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,"
        "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,"
        "acompressor=threshold=-18dB:ratio=3:attack=5:release=80,"
        "loudnorm=I=-15:TP=-1.5:LRA=9,afade=t=in:d=0.01"
    )
    dst = OUT / f"{name}.mp3"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", af, "-ar", "44100", "-ac", "1", "-b:a", "96k", str(dst)], check=True)


def duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return -1


if __name__ == "__main__":
    force = "--force" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, (voice, text, speed) in LINES.items():
        if only and name not in only:
            continue
        raw = RAW / f"{name}.mp3"
        if force or not raw.exists():
            try:
                tts(name, voice, text, speed)
            except Exception as e:  # keep going; missing clips fall back to synth sounds
                print("FAILED", name, e)
                continue
        finish(raw, name)
        print(f"{name:18s} raw={duration(raw):5.2f}s  final={duration(OUT / (name + '.mp3')):5.2f}s  {raw.stat().st_size}B")
