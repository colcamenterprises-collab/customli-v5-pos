#!/usr/bin/env python3
"""Generate Android legacy/adaptive icon resources from approved two-bar symbol.
Artwork geometry sampled from the approved 2048px PNG (transparent outside bars).
No image processing dependencies required; PNG is generated with Python stdlib.
"""
import math,struct,zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'android-v5/app/src/main/res'
LIME=(217,255,79)
def png(path,size,foreground=False):
  # Approved logo artwork: 948x692 bounding box in 2048px image.
  # Inset safely within Android's adaptive icon mask; never clip the two bars.
  scale=size/1024
  rects=[(212,293,812,446,28),(212,578,812,731,28)]
  rows=[]
  for y in range(size):
    row=bytearray([0]);py=(y+.5)/scale
    for x in range(size):
      px=(x+.5)/scale
      hit=False
      for x0,y0,x1,y1,r in rects:
        dx=max(x0+r-px,0,px-(x1-r));dy=max(y0+r-py,0,py-(y1-r))
        if x0<=px<=x1 and y0<=py<=y1 and dx*dx+dy*dy<=r*r:hit=True;break
      row.extend((*LIME,255) if hit else ((0,0,0,0) if foreground else (0,0,0,255)))
    rows.append(row)
  def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
  raw=b''.join(rows);data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
  path.write_bytes(data)
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
  directory=ROOT/('mipmap-'+density)
  for filename,foreground in [('ic_launcher.png',False),('ic_launcher_round.png',False),('ic_launcher_foreground.png',True)]:png(directory/filename,size,foreground)
(ROOT/'values/ic_launcher_background.xml').write_text('<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#000000</color></resources>\n')
print('Android icon: approved black background, lime two-bar symbol, adaptive and legacy resources generated')
