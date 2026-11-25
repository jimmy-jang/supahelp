# Run from apps/desktop: python3 scripts/build-dmg-background.py
# Draws the DMG window background (660x400) at 1x and 2x. Layout coords live in forge.config.mts.
from PIL import Image, ImageDraw

W, H = 660, 400
for scale, name in ((1, 'background.png'), (2, 'background@2x.png')):
    s = scale * 4  # draw at 4x then downsample for smooth lines
    img = Image.new('RGB', (W * s, H * s), '#f6f6f8')
    d = ImageDraw.Draw(img)
    cx, cy = 330 * s, 185 * s
    pts = [(cx - 14 * s, cy - 28 * s), (cx + 14 * s, cy), (cx - 14 * s, cy + 28 * s)]
    d.line(pts, fill='#9a9aa3', width=10 * s, joint='curve')
    for x, y in (pts[0], pts[2]):  # round the line caps
        d.ellipse((x - 5 * s, y - 5 * s, x + 5 * s, y + 5 * s), fill='#9a9aa3')
    d.ellipse((pts[1][0] - 5 * s, cy - 5 * s, pts[1][0] + 5 * s, cy + 5 * s), fill='#9a9aa3')
    img.resize((W * scale, H * scale), Image.LANCZOS).save(f'assets/dmg/{name}')
