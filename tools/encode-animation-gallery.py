"""Encode renderer PNG frames as a looping GIF for GitHub documentation."""
from pathlib import Path
import sys
from PIL import Image

source, target = Path(sys.argv[1]), Path(sys.argv[2])
frames = []
for path in sorted(source.glob('*.png')):
    with Image.open(path) as image:
        image = image.convert('RGB').resize((640, 480), Image.Resampling.LANCZOS)
        frames.append(image.quantize(colors=128))
if len(frames) < 2:
    raise SystemExit('At least two rendered frames are required')
frames[0].save(target, save_all=True, append_images=frames[1:], duration=100,
               loop=0, disposal=2, optimize=False)
