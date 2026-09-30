"""Replace the region of a file between two marker lines with new content.
usage: python tools/splice.py file start_marker end_marker replacement_file
The start marker line is replaced; the end marker line is kept.
"""
import sys

path, start, end, rep = sys.argv[1:5]
src = open(path, encoding="utf-8").read()
i = src.index(start)
j = src.index(end, i)
new = open(rep, encoding="utf-8").read()
open(path, "w", encoding="utf-8", newline="\n").write(src[:i] + new + src[j:])
print("spliced", path, i, j)
