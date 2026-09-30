"""Tile screenshots into one review sheet (keeps each sheet under 2000px).
usage: python tools/montage.py out.png cols scale file1 file2 ...
"""
import sys
from PIL import Image, ImageDraw

out, cols, scale, files = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), sys.argv[4:]
imgs = [Image.open(f).convert("RGB") for f in files]
w, h = int(imgs[0].width * scale), int(imgs[0].height * scale)
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w + (cols - 1) * 2, rows * h + (rows - 1) * 2), (255, 0, 255))
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(imgs, files)):
    x, y = (i % cols) * (w + 2), (i // cols) * (h + 2)
    sheet.paste(im.resize((w, h), Image.Resampling.NEAREST), (x, y))
    d.rectangle([x, y + h - 11, x + 60, y + h], fill=(0, 0, 0))
    d.text((x + 2, y + h - 11), f.split("/")[-1].split("\\")[-1][:12], fill=(0, 255, 0))
assert sheet.width <= 2000 and sheet.height <= 2000, sheet.size
sheet.save(out)
print(out, sheet.size)
