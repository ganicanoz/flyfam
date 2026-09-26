#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 source output title subtitle" >&2
  exit 2
fi

source_image="$1"
output_image="$2"
title="$3"
subtitle="$4"

canvas_width=1290
canvas_height=2796
device_width=1000
device_x=145
device_y=738
font="/System/Library/Fonts/SFNS.ttf"
asset_dir="docs/app-store-screenshots/apple-bezels"
bezel="$asset_dir/iPhone-16-Pro-Max-Black-Titanium-Portrait.png"
screen_mask="$asset_dir/iPhone-16-Pro-Max-Screen-Mask.png"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$(dirname "$output_image")"

# Apple's official iPhone 16 Pro Max bezel is 1470x3000. Its supplied screen
# mask is 1320x2868 at +75+66 and preserves the Dynamic Island cutout.
magick "$source_image" \
  -resize '1320x2868^' -gravity center -extent 1320x2868 \
  "$work_dir/screen.png"

magick "$screen_mask" -alpha extract "$work_dir/screen-alpha.png"

magick "$work_dir/screen.png" "$work_dir/screen-alpha.png" \
  -alpha off -compose CopyOpacity -composite \
  "$work_dir/masked-screen.png"

magick "$bezel" \
  "$work_dir/masked-screen.png" -geometry '+75+66' -compose Over -composite \
  -resize "${device_width}x" \
  "$work_dir/device.png"

magick "$work_dir/device.png" \
  \( +clone -channel A -separate +channel \
     -background '#02081799' -shadow 75x34+0+22 \) \
  +swap -background none -layers merge +repage \
  "$work_dir/device-shadow.png"

magick -size "${canvas_width}x${canvas_height}" gradient:'#061633-#124FBF' \
  -fill '#246BFD' -draw 'circle 1180,260 1510,260' \
  -fill '#FF5C8A' -draw 'circle 1148,230 1228,230' \
  -fill '#8EB5FF33' -draw 'circle 90,640 -260,640' \
  -stroke '#A8C4FF88' -strokewidth 4 -fill none \
  -draw "path 'M 55,590 C 250,540 360,620 535,570'" \
  -stroke '#A8C4FF88' -strokewidth 4 -fill '#A8C4FF' \
  -draw 'circle 55,590 63,590 circle 535,570 543,570' \
  \( 'mobile/assets/splash-wordmark-mono-white.png' -resize '270x' \) \
  -gravity northwest -geometry '+76+70' -composite \
  -font "$font" -fill '#CFE0FF' -pointsize 25 -gravity north \
  -annotate '+0+93' 'UÇUŞ EKİBİ & AİLE' \
  -font "$font" -weight 700 -fill white -pointsize 88 -interline-spacing -8 \
  -annotate '+0+195' "$title" \
  -font "$font" -weight 400 -fill '#D8E6FF' -pointsize 37 \
  -annotate '+0+468' "$subtitle" \
  "$work_dir/device-shadow.png" -gravity northwest \
  -geometry "+${device_x}+${device_y}" -composite \
  -alpha off -strip "$output_image"
