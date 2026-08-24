#!/usr/bin/env python3
"""Native splash = #B4CCFB + app icon + FlyFam wordmark stacked (same width, ~26% screen)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / "assets" / "splash-logo-ios-default-1024.png"
WORDMARK = ROOT / "assets" / "splash-wordmark.png"
BG = (180, 204, 251)  # #B4CCFB
# splashBrand.ts: min(130pt, round(screenWidth * 0.26))
LOGO_FRACTION = 0.26
LOGO_MAX_PT = 130
REF_SCREEN_W_PT = 390
STACK_GAP_FRACTION = 0.1  # gap between icon and wordmark vs icon width

ANDROID_LOGO_PX = {
    "drawable-mdpi": 288,
    "drawable-hdpi": 432,
    "drawable-xhdpi": 576,
    "drawable-xxhdpi": 864,
    "drawable-xxxhdpi": 1152,
}


def logo_pt_for_screen(screen_w_pt: float) -> int:
    return min(LOGO_MAX_PT, round(screen_w_pt * LOGO_FRACTION))


def resize_to_width(path: Path, max_width_px: int) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    lw, lh = img.size
    r = min(max_width_px / lw, max_width_px / lh)
    nw, nh = int(lw * r), int(lh * r)
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def compose_icon_and_wordmark(icon_width_px: int) -> Image.Image:
    """Square app icon + wordmark directly below, both same width."""
    icon = resize_to_width(ICON, icon_width_px)
    wordmark = resize_to_width(WORDMARK, icon_width_px)
    gap = max(8, round(icon_width_px * STACK_GAP_FRACTION))
    w = max(icon.width, wordmark.width)
    h = icon.height + gap + wordmark.height
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(icon, ((w - icon.width) // 2, 0), icon)
    out.paste(wordmark, ((w - wordmark.width) // 2, icon.height + gap), wordmark)
    return out


def stack_aspect_ratio(icon_width_px: int) -> float:
    block = compose_icon_and_wordmark(icon_width_px)
    return block.height / block.width if block.width else 1.0


def write_android() -> None:
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    ref_icon_w = logo_pt_for_screen(REF_SCREEN_W_PT)
    for folder, box in ANDROID_LOGO_PX.items():
        icon_w = max(32, round(ref_icon_w * (box / 288.0)))
        block = compose_icon_and_wordmark(icon_w)
        out = Image.new("RGBA", (box, box), (*BG, 255))
        scale = min((box * 0.88) / block.width, (box * 0.88) / block.height)
        if scale < 1:
            block = block.resize(
                (int(block.width * scale), int(block.height * scale)),
                Image.Resampling.LANCZOS,
            )
        lx = (box - block.width) // 2
        ly = (box - block.height) // 2
        out.paste(block, (lx, ly), block)
        path = res / folder / "splashscreen_logo.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        out.save(path, format="PNG", optimize=True)
        print(f"Wrote {path}")


def write_ios() -> None:
    imageset = ROOT / "ios" / "FlyFam" / "Images.xcassets" / "SplashScreenLogo.imageset"
    ref_icon_w = logo_pt_for_screen(REF_SCREEN_W_PT)
    for scale, suffix in ((1, "image.png"), (2, "image@2x.png"), (3, "image@3x.png")):
        block = compose_icon_and_wordmark(ref_icon_w * scale)
        path = imageset / suffix
        block.save(path, format="PNG", optimize=True)
        print(f"Wrote {path} ({block.size[0]}x{block.size[1]})")


def write_expo_splash_asset() -> None:
    canvas_w, canvas_h = 1242, 2688
    icon_w = max(48, round(logo_pt_for_screen(REF_SCREEN_W_PT) * (canvas_w / REF_SCREEN_W_PT)))
    block = compose_icon_and_wordmark(icon_w)
    out = Image.new("RGBA", (canvas_w, canvas_h), (*BG, 255))
    lx = (canvas_w - block.width) // 2
    ly = (canvas_h - block.height) // 2
    out.paste(block, (lx, ly), block)
    path = ROOT / "assets" / "splash-logo-expo-native.png"
    out.convert("RGB").save(path, format="PNG", optimize=True)
    pct = 100 * block.width / canvas_w
    print(f"Wrote {path} (stack {block.size[0]}x{block.size[1]}, width {pct:.0f}% of screen)")


def main() -> None:
    aspect = stack_aspect_ratio(logo_pt_for_screen(REF_SCREEN_W_PT))
    print(f"Stack aspect height/width @1x: {aspect:.3f} (use in SplashScreen.storyboard)")
    write_android()
    write_ios()
    write_expo_splash_asset()


if __name__ == "__main__":
    main()
