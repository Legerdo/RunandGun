"""Convert raw generated paintings into low-res, palette-limited parallax layers.

usage: python tools/process_bg.py
Reads art/raw/bg_*.png, writes public/bg/bg_*.png (originals are left untouched).
"""
from pathlib import Path
from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
OUT = ROOT / "public" / "bg"
OUT.mkdir(parents=True, exist_ok=True)

# name: (scale, crop_top, crop_bottom (in scaled px), colors, saturation, brightness, mirror_tile)
SPECS = {
    "bg_beach": (0.375, 98, 248, 40, 0.92, 1.0, False),
    "bg_town": (0.30, 78, 268, 40, 0.85, 1.02, True),
    "bg_rail": (0.30, 38, 198, 40, 0.9, 1.0, True),
    "bg_docks": (0.30, 34, 206, 40, 0.9, 0.92, True),
}


def process(name: str) -> None:
    src = RAW / f"{name}.png"
    if not src.exists():
        print("skip (missing)", name)
        return
    scale, top, bottom, colors, sat, bri, mirror = SPECS[name]
    img = Image.open(src).convert("RGB")
    w, h = img.size
    img = img.resize((round(w * scale), round(h * scale)), Image.Resampling.BOX)
    img = img.crop((0, top, img.width, min(img.height, bottom)))
    img = ImageEnhance.Color(img).enhance(sat)
    img = ImageEnhance.Brightness(img).enhance(bri)
    # palette reduction without dithering keeps crisp pixel clusters
    img = img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    if mirror:
        tile = Image.new("RGB", (img.width * 2, img.height))
        tile.paste(img, (0, 0))
        tile.paste(ImageOps.mirror(img), (img.width, 0))
        img = tile
    img.save(OUT / f"{name}.png", optimize=True)
    print("wrote", name, img.size)


if __name__ == "__main__":
    for n in SPECS:
        process(n)
