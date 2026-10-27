"""Builds assets/capri/capri-full.png from the original cut-out (assets/capri/capri-cutout.png).

The cut-out has one arm reaching out and one hanging down. The hanging one is removed here;
the shader draws a mirrored copy of the reaching arm in its place, so both hands match and
both arms can be animated. The canvas is widened so the mirrored hand fits.

    python tools/build-sprite.py [--preview out.png]

Needs Pillow. Keep the masks below in sync with src/renderer/js/sprite.js.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'capri' / 'capri-cutout.png'
OUT = ROOT / 'assets' / 'capri' / 'capri-full.png'
WIDTH = 240     # room for the mirrored hand
MIRROR = 234    # x' = MIRROR - x puts the left shoulder (98, 168) on the right one


def hanging_arm(x, y):
    if y < 168 or y > 292:
        return False
    if x < 128 + max(0, y - 190) * 0.2:   # the leg next to it stays
        return False
    return not (y < 195 and x > 160)      # nor the hair spike at x~178


def reaching_arm(x, y):
    """The arm on the left of the cut-out (same rule as armL() in the shader)."""
    if x > 101 or y > 234:
        return False
    top = 159 + (98 - x) * 0.5
    bot = 234 if x < 50 else 178 + (98 - x) * 0.62
    return top <= y <= bot


def main():
    src = Image.open(SRC).convert('RGBA')
    out = Image.new('RGBA', (WIDTH, src.height), (0, 0, 0, 0))
    out.paste(src, (0, 0))
    px = out.load()
    for y in range(out.height):
        for x in range(src.width):
            if hanging_arm(x, y):
                px[x, y] = (0, 0, 0, 0)
    out.save(OUT, optimize=True)
    print(f'wrote {OUT} {out.size}')

    if '--preview' in sys.argv:
        # what the shader draws at rest: the mirrored arm tucked under the body
        arm = Image.new('RGBA', out.size, (0, 0, 0, 0))
        apx, spx = arm.load(), src.load()
        for y in range(src.height):
            for x in range(src.width):
                if reaching_arm(x, y) and 0 <= MIRROR - x < WIDTH:
                    apx[MIRROR - x, y] = spx[x, y]
        arm.alpha_composite(out)
        bg = Image.new('RGBA', out.size, (200, 200, 200, 255))
        bg.alpha_composite(arm)
        path = sys.argv[sys.argv.index('--preview') + 1]
        bg.resize((out.width * 2, out.height * 2), Image.NEAREST).save(path)
        print(f'preview {path}')


if __name__ == '__main__':
    main()
