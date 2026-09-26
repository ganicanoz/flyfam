#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "usage: $0 source output width height title subtitle crop_height" >&2
  exit 2
fi

source_image="$1"
output_image="$2"
canvas_width="$3"
canvas_height="$4"
title="$5"
subtitle="$6"
crop_height="$7"

font_regular="/System/Library/Fonts/SFNS.ttf"
font_bold="/System/Library/Fonts/SFNS.ttf"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

if [ "$canvas_width" -lt 1600 ]; then
  screen_width=1090
  screen_x=100
  screen_y=590
  title_size=82
  subtitle_size=38
  wordmark_width=250
  top_pad=92
  radius=64
else
  screen_width=1824
  screen_x=120
  screen_y=520
  title_size=92
  subtitle_size=42
  wordmark_width=285
  top_pad=75
  radius=54
fi

mkdir -p "$(dirname "$output_image")"

magick "$source_image" \
  -resize "${screen_width}x" \
  -gravity north \
  -crop "${screen_width}x${crop_height}+0+0" +repage \
  "$work_dir/screen.png"

screen_height="$(magick identify -format '%h' "$work_dir/screen.png")"

magick -size "${screen_width}x${screen_height}" xc:none \
  -fill white -draw "roundrectangle 0,0 $((screen_width-1)),$((screen_height-1)) ${radius},${radius}" \
  "$work_dir/mask.png"

magick "$work_dir/screen.png" "$work_dir/mask.png" \
  -alpha off -compose CopyOpacity -composite \
  "$work_dir/rounded-screen.png"

magick -size "${screen_width}x${screen_height}" xc:none \
  -fill '#17376D22' -draw "roundrectangle 10,18 $((screen_width-10)),$((screen_height-4)) ${radius},${radius}" \
  -blur 0x24 \
  "$work_dir/shadow.png"

magick -size "${canvas_width}x${canvas_height}" gradient:'#F8FAFF-#E7EFFF' \
  -fill '#246BFD18' -draw "circle $((canvas_width-90)),120 $((canvas_width+260)),120" \
  -fill '#7AA7FF16' -draw "circle 40,$((canvas_height-120)) -260,$((canvas_height-120))" \
  \( "mobile/docs/brand-refine/flyfam-wordmark-refine-color-transparent.png" -resize "${wordmark_width}x" \) \
  -gravity northwest -geometry "+${top_pad}+${top_pad}" -composite \
  -font "$font_bold" -fill '#0A1C46' -pointsize "$title_size" \
  -gravity north -interline-spacing -6 -annotate "+0+$((top_pad+125))" "$title" \
  -font "$font_regular" -fill '#52627E' -pointsize "$subtitle_size" \
  -gravity north -annotate "+0+$((top_pad+350))" "$subtitle" \
  "$work_dir/shadow.png" -gravity northwest -geometry "+${screen_x}+$((screen_y+10))" -composite \
  "$work_dir/rounded-screen.png" -gravity northwest -geometry "+${screen_x}+${screen_y}" -composite \
  -alpha off -strip "$output_image"
