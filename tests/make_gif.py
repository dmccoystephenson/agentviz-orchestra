"""Assemble PNG frames into an animated GIF (Pillow): make_gif.py out.gif fps frame1.png ..."""
import sys

from PIL import Image

out, fps, frames = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
imgs = [Image.open(f).convert("RGB") for f in frames]
pal = imgs[len(imgs) // 2].quantize(colors=200, method=Image.Quantize.MEDIANCUT)
seq = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
seq[0].save(out, save_all=True, append_images=seq[1:], duration=int(1000 / fps), loop=0, optimize=True)
