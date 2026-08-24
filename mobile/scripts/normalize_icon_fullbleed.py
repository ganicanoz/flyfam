#!/usr/bin/env python3
"""
App Store ikonu: dıştaki beyaz boşluğu kırpıp içeriği 1024x1024 kareye ölçekler.
Kenarlardan flood-fill ile dışarıdaki açık renk ayrılır; ikon içindeki beyaz korunur.
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image


def composite_gray_rgba(r: int, g: int, b: int, a: int) -> float:
    af = a / 255.0
    cr = r * af + 255.0 * (1.0 - af)
    cg = g * af + 255.0 * (1.0 - af)
    cb = b * af + 255.0 * (1.0 - af)
    return (cr + cg + cb) / 3.0


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    # Çıktıyı aynı dosyaya yazar; .icon paketini bozmamak için varsayılan assets/icon-1024.png
    src = root / "assets" / "icon-1024.png"
    if len(sys.argv) >= 2:
        src = Path(sys.argv[1])
    if not src.is_file():
        raise SystemExit(f"Bulunamadı: {src}")

    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    threshold = 246.0

    def gray_at(x: int, y: int) -> float:
        r, g, b, a = px[x, y]
        return composite_gray_rgba(r, g, b, a)

    outside = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def try_add(x: int, y: int) -> None:
        if 0 <= x < w and 0 <= y < h and not outside[y][x] and gray_at(x, y) >= threshold:
            outside[y][x] = True
            q.append((x, y))

    for x in range(w):
        try_add(x, 0)
        try_add(x, h - 1)
    for y in range(h):
        try_add(0, y)
        try_add(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not outside[ny][nx] and gray_at(nx, ny) >= threshold:
                outside[ny][nx] = True
                q.append((nx, ny))

    min_x, min_y = w, h
    max_x, max_y = 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            if not outside[y][x]:
                found = True
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if not found:
        raise SystemExit("İçerik bulunamadı (eşik yanlış olabilir).")

    pad = 2
    left = max(0, min_x - pad)
    top = max(0, min_y - pad)
    right = min(w, max_x + 1 + pad)
    bottom = min(h, max_y + 1 + pad)

    cropped = im.crop((left, top, right, bottom))
    cw, ch = cropped.size
    side = max(cw, ch)

    cr = cropped.convert("RGB")
    cpx = cr.load()
    # Dolgu: üst-orta şerit (genelde gökyüzü); kalp/pembe karışmaz
    y1 = max(1, ch // 4)
    x0 = cw // 4
    x1 = max(x0 + 1, 3 * cw // 4)
    samples: list[tuple[int, int, int]] = []
    for y in range(0, y1):
        for x in range(x0, x1):
            samples.append(cpx[x, y])
    if len(samples) < 8:
        samples = [cpx[cw // 2, ch // 8]]
    # Mavi baskın pikselleri tercih et (gökyüzü); yoksa sabit açık mavi
    skyish = [p for p in samples if p[2] >= p[0] - 15 and p[2] >= p[1] - 15]
    use = skyish if len(skyish) > max(12, len(samples) // 8) else samples
    fill = tuple(int(round(sum(p[i] for p in use) / len(use))) for i in range(3))

    square = Image.new("RGB", (side, side), fill)
    ox = (side - cw) // 2
    oy = (side - ch) // 2
    square.paste(cropped, (ox, oy), cropped.split()[3])

    out = square.resize((1024, 1024), Image.Resampling.LANCZOS)
    backup = src.with_name("icon-1024.before-fullbleed.png")
    if not backup.exists():
        src.rename(backup)
        print(f"Yedek: {backup.name}")
    else:
        print("(Yedek zaten var: icon-1024.before-fullbleed.png)")
    out.save(src, format="PNG", optimize=True)
    print(f"Güncellendi: {src} (1024x1024, kenara kadar dolu)")


if __name__ == "__main__":
    main()
