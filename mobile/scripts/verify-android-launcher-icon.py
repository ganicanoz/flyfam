#!/usr/bin/env python3
from pathlib import Path
import sys

try:
    from PIL import Image, ImageChops
except ImportError:
    print("ERROR: Pillow is required. Install with: python3 -m pip install --user pillow")
    sys.exit(1)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    ios_src = root / "ios/FlyFam/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png"
    if not ios_src.exists():
        print(f"ERROR: Missing iOS source icon: {ios_src}")
        return 1

    # We intentionally avoid adaptive launcher XML to prevent device-dependent cropping differences.
    adaptive_files = [
        root / "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
        root / "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml",
    ]
    existing_adaptive = [str(p) for p in adaptive_files if p.exists()]
    if existing_adaptive:
        print("ERROR: Adaptive icon XML exists (can cause unexpected icon look):")
        for p in existing_adaptive:
            print(f"  - {p}")
        return 1

    sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }

    src_img = Image.open(ios_src).convert("RGB")
    failures = []
    for density, px in sizes.items():
        launcher = root / f"android/app/src/main/res/mipmap-{density}/ic_launcher.png"
        round_icon = root / f"android/app/src/main/res/mipmap-{density}/ic_launcher_round.png"
        foreground = root / f"android/app/src/main/res/mipmap-{density}/ic_launcher_foreground.png"
        for p in (launcher, round_icon, foreground):
            if not p.exists():
                failures.append(f"Missing file: {p}")
                continue

        if launcher.exists():
            expected = src_img.resize((px, px), Image.Resampling.LANCZOS)
            actual = Image.open(launcher).convert("RGB")
            if ImageChops.difference(expected, actual).getbbox() is not None:
                failures.append(f"Pixel mismatch: {launcher} (not matching iOS source resize)")

    if failures:
        print("ERROR: Android launcher icon verification failed:")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("OK: Android launcher icons match iOS source and adaptive XML is absent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
