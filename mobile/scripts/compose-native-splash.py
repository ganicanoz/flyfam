#!/usr/bin/env python3
"""DEPRECATED — uçaklı splash. Yerine: scripts/sync-native-splash.py (#B4CCFB + logo)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BG = ROOT / "assets" / "aviation-bg-landing.png"
LOGO = ROOT / "assets" / "splash-logo-ios-default-1024.png"
OUT = ROOT / "assets" / "splash-aircraft-with-logo.png"
# Standart dikey splash tuvali (Expo / iOS önerileriyle uyumlu); cover ile cihazda kırpılır.
CANVAS_W, CANVAS_H = 1242, 2688
# RN `splashLogoSizePx`: min(200, round(screenWidth * 0.32)) — tipik iPhone mantıksal genişliği.
REF_SCREEN_W_PT = 390


def splash_logo_pt_for_reference_screen() -> int:
    return min(200, round(REF_SCREEN_W_PT * 0.32))


def logo_pixel_on_canvas() -> int:
    """Tuval üzerindeki logo kutusu; cihazda önceki intro ile aynı oran."""
    pt = splash_logo_pt_for_reference_screen()
    return max(48, round(pt * (CANVAS_W / float(REF_SCREEN_W_PT))))


def main() -> None:
    bg = Image.open(BG).convert("RGB")
    logo = Image.open(LOGO).convert("RGBA")

    scale = max(CANVAS_W / bg.width, CANVAS_H / bg.height)
    nw, nh = int(bg.width * scale), int(bg.height * scale)
    bg = bg.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - CANVAS_W) // 2
    top = (nh - CANVAS_H) // 2
    bg = bg.crop((left, top, left + CANVAS_W, top + CANVAS_H))

    box = logo_pixel_on_canvas()
    lw, lh = logo.size
    r = min(box / lw, box / lh)
    nw, nh = int(lw * r), int(lh * r)
    logo_r = logo.resize((nw, nh), Image.Resampling.LANCZOS)

    lx = (CANVAS_W - nw) // 2
    ly = (CANVAS_H - nh) // 2

    out = Image.new("RGBA", (CANVAS_W, CANVAS_H))
    out.paste(bg, (0, 0))
    out.paste(logo_r, (lx, ly), logo_r)
    out.convert("RGB").save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT} ({CANVAS_W}x{CANVAS_H})")


if __name__ == "__main__":
    main()
