#!/usr/bin/env python3
"""
Android adaptive icon: tam opak ön plan (şeffaf yok).
Açık gökyüzü / çerçeve mavilerini marka rengi #4A90E2 ile değiştirir; kalp ve uçak korunur.
Çıktı: assets/icon-android-adaptive-foreground-1024.png
Ayrıca: assets/adaptive-icon-background-1024.png (düz #4A90E2, backgroundImage için).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

BRAND = (74, 144, 226)  # #4A90E2
# icon-1024 dış çerçeve ve gökyüzü örnekleri (Öklid yakınlığı ile eşleşir)
SKY_REFS = (
    (166, 195, 248),
    (178, 199, 246),
    (189, 209, 232),
    (180, 205, 245),
    (200, 215, 250),
    (150, 185, 242),
    (210, 225, 252),
    (140, 175, 235),
)


def min_dist_rgb(r: int, g: int, b: int) -> float:
    return min(math.sqrt((r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2) for x, y, z in SKY_REFS)


def is_protected_content(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return False
    # Pembe kalp
    if r > 200 and b < 210 and r > b + 25:
        return True
    # Beyaz/gümüş uçak ve highlight
    if r > 238 and g > 238 and b > 236:
        return True
    # Koyu gölge / kontur
    if max(r, g, b) < 95:
        return True
    return False


def is_sky_replace(r: int, g: int, b: int, a: int) -> bool:
    if is_protected_content(r, g, b, a):
        return False
    if min_dist_rgb(r, g, b) < 52:
        return True
    # Açık mavi gökyüzü (yüksek B, orta R/G)
    if b > 195 and r > 125 and g > 155 and b >= r - 35 and b >= g - 25 and r < 235 and g < 235:
        return True
    return False


def composite_on_brand(r: int, g: int, b: int, a: int) -> tuple[int, int, int]:
    af = a / 255.0
    return tuple(int(round(c * af + BRAND[i] * (1.0 - af))) for i, c in enumerate((r, g, b)))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    # Kaynak: app.config.js APP_ICON_1024 ile aynı dosya
    src = root / "assets" / "icon-final-iOS-Default-1024x1024@1x.png"
    if len(sys.argv) >= 2:
        src = Path(sys.argv[1])
    if not src.is_file():
        raise SystemExit(f"Bulunamadı: {src}")

    fg_out = root / "assets" / "icon-android-adaptive-foreground-1024.png"
    bg_out = root / "assets" / "adaptive-icon-background-1024.png"

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    out = Image.new("RGB", (w, h), BRAND)

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_sky_replace(r, g, b, a):
                out.putpixel((x, y), BRAND)
            elif a < 255:
                out.putpixel((x, y), composite_on_brand(r, g, b, a))
            else:
                out.putpixel((x, y), (r, g, b))

    out.save(fg_out, format="PNG", optimize=True)
    Image.new("RGB", (1024, 1024), BRAND).save(bg_out, format="PNG", optimize=True)
    print(f"Yazıldı: {fg_out.name}, {bg_out.name}")


if __name__ == "__main__":
    main()
