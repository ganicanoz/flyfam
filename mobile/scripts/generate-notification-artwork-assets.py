#!/usr/bin/env python3
"""Regenerate monochrome Android small icons + optimized push JPEGs from artwork masters."""
from __future__ import annotations

import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ART = os.path.join(ROOT, 'assets/notification-artwork')
PUSH = os.path.join(ART, 'push')

SOURCES = {
    'takeoff': 'flyfam-takeoff-v3-formal.png',
    'landing': 'flyfam-landing-v3-formal.png',
    'roster': 'flyfam-roster-v3-formal.png',
}
TRANSPARENT = {
    'takeoff': 'flyfam-takeoff-transparent.png',
    'landing': 'flyfam-landing-transparent.png',
    'roster': 'flyfam-roster-transparent.png',
}
DRAWABLE = {
    'takeoff': 'notification_icon_takeoff',
    'landing': 'notification_icon_landed',
    'roster': 'notification_icon_roster',
}
SIZES = {
    'drawable-mdpi': 24,
    'drawable-hdpi': 36,
    'drawable-xhdpi': 48,
    'drawable-xxhdpi': 72,
    'drawable-xxxhdpi': 96,
}


def to_white_silhouette(src_path: str, size: int) -> Image.Image:
    im = Image.open(src_path).convert('RGBA')
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        im = im.crop(bbox)
    pad = max(1, int(size * 0.08))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    im.thumbnail((size - 2 * pad, size - 2 * pad), Image.Resampling.LANCZOS)
    ox = (size - im.width) // 2
    oy = (size - im.height) // 2
    canvas.paste(im, (ox, oy), im)
    _r, _g, _b, a = canvas.split()
    a = a.point(lambda p: 255 if p > 40 else 0)
    white = Image.new('L', canvas.size, 255)
    return Image.merge('RGBA', (white, white, white, a))


def main() -> None:
    os.makedirs(PUSH, exist_ok=True)
    for key, name in SOURCES.items():
        im = Image.open(os.path.join(ART, name)).convert('RGB')
        im = im.resize((512, 512), Image.Resampling.LANCZOS)
        jpg = os.path.join(PUSH, f'flyfam-{key}-v3-push.jpg')
        png = os.path.join(PUSH, f'flyfam-{key}-v3-push.png')
        im.save(jpg, 'JPEG', quality=82, optimize=True)
        im.save(png, 'PNG', optimize=True)
        print(key, 'push', os.path.getsize(jpg), 'bytes jpg')

    for key, draw_name in DRAWABLE.items():
        src = os.path.join(ART, TRANSPARENT[key])
        for dens, sz in SIZES.items():
            ddir = os.path.join(ROOT, 'android/app/src/main/res', dens)
            os.makedirs(ddir, exist_ok=True)
            to_white_silhouette(src, sz).save(os.path.join(ddir, f'{draw_name}.png'))
        print('small', draw_name, 'ok')


if __name__ == '__main__':
    main()
