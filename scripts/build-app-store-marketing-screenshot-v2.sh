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
screen_width=930
screen_height=2070
screen_x=180
screen_y=700
frame_pad=24
frame_x=$((screen_x-frame_pad))
frame_y=$((screen_y-frame_pad))
frame_width=$((screen_width+frame_pad*2))
frame_height=$((screen_height+frame_pad*2))
font="/System/Library/Fonts/SFNS.ttf"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$(dirname "$output_image")"

magick "$source_image" \
  -resize "${screen_width}x" \
  -gravity north \
  -crop "${screen_width}x${screen_height}+0+0" +repage \
  "$work_dir/screen.png"

magick -size "${screen_width}x${screen_height}" xc:none \
  -fill white -draw "roundrectangle 0,0 $((screen_width-1)),$((screen_height-1)) 70,70" \
  "$work_dir/screen-mask.png"

magick "$work_dir/screen.png" "$work_dir/screen-mask.png" \
  -alpha off -compose CopyOpacity -composite \
  "$work_dir/rounded-screen.png"

magick -size "${frame_width}x${frame_height}" xc:none \
  -fill '#07152E' -draw "roundrectangle 0,0 $((frame_width-1)),$((frame_height-1)) 92,92" \
  "$work_dir/frame.png"

magick -size "${frame_width}x${frame_height}" xc:none \
  -fill '#02081766' -draw "roundrectangle 12,24 $((frame_width-12)),$((frame_height-4)) 92,92" \
  -blur 0x34 \
  "$work_dir/shadow.png"

magick -size "${canvas_width}x${canvas_height}" gradient:'#061633-#124FBF' \
  -fill '#246BFD' -draw "circle 1180,260 1510,260" \
  -fill '#FF5C8A' -draw "circle 1148,230 1228,230" \
  -fill '#8EB5FF33' -draw "circle 90,640 -260,640" \
  -stroke '#A8C4FF88' -strokewidth 4 -fill none \
  -draw "path 'M 55,590 C 250,540 360,620 535,570'" \
  -stroke '#A8C4FF88' -strokewidth 4 -fill '#A8C4FF' \
  -draw "circle 55,590 63,590 circle 535,570 543,570" \
  \( "mobile/assets/splash-wordmark-mono-white.png" -resize '270x' \) \
  -gravity northwest -geometry '+76+70' -composite \
  -font "$font" -fill '#CFE0FF' -pointsize 25 -gravity north \
  -annotate '+0+93' 'UÇUŞ EKİBİ & AİLE' \
  -font "$font" -weight 700 -fill white -pointsize 88 -interline-spacing -8 -gravity north \
  -annotate '+0+195' "$title" \
  -font "$font" -weight 400 -fill '#D8E6FF' -pointsize 37 -gravity north \
  -annotate '+0+468' "$subtitle" \
  "$work_dir/shadow.png" -gravity northwest -geometry "+${frame_x}+$((frame_y+8))" -composite \
  "$work_dir/frame.png" -gravity northwest -geometry "+${frame_x}+${frame_y}" -composite \
  "$work_dir/rounded-screen.png" -gravity northwest -geometry "+${screen_x}+${screen_y}" -composite \
  -fill '#FFFFFF22' -stroke '#FFFFFF55' -strokewidth 2 \
  -draw "roundrectangle ${frame_x},${frame_y} $((frame_x+frame_width)),$((frame_y+frame_height)) 92,92" \
  -alpha off -strip "$output_image"
