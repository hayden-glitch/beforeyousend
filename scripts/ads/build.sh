#!/usr/bin/env bash
# Assemble TikTok ad MP4s: 3 beats per creative, Ken Burns zoompan + crossfade, silent H.264.
set -euo pipefail
cd /tmp/adsrc
mkdir -p mp4 seg
PIX="-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p"

for cid in cr03 cr06 cr09; do
  # Beat 1: 3.4s slow zoom-in (102 frames @30fps, pre-scale 1350x2400 for headroom)
  ffmpeg -y -loglevel error -i png/$cid-b1.png -vf \
    "scale=1350:2400:flags=lanczos,zoompan=z='1+0.00088*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=102:s=1080x1920:fps=30,format=yuv420p" \
    $PIX seg/$cid-s1.mp4
  # Beat 2: 2.7s gentle zoom-in (81 frames)
  ffmpeg -y -loglevel error -i png/$cid-b2.png -vf \
    "scale=1350:2400:flags=lanczos,zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=81:s=1080x1920:fps=30,format=yuv420p" \
    $PIX seg/$cid-s2.mp4
  # Beat 3: 2.7s settle (zoom-out 1.08 -> 1.0)
  ffmpeg -y -loglevel error -i png/$cid-b3.png -vf \
    "scale=1350:2400:flags=lanczos,zoompan=z='1.08-0.001*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=81:s=1080x1920:fps=30,format=yuv420p" \
    $PIX seg/$cid-s3.mp4
  # Crossfade: 0.6s fades; offsets 2.8 (3.4-0.6) and 4.9 (5.5-0.6) -> total 7.6s
  ffmpeg -y -loglevel error -i seg/$cid-s1.mp4 -i seg/$cid-s2.mp4 -i seg/$cid-s3.mp4 -filter_complex \
    "[0:v][1:v]xfade=transition=fade:duration=0.6:offset=2.8[v01];[v01][2:v]xfade=transition=fade:duration=0.6:offset=4.9[v]" \
    -map "[v]" $PIX -movflags +faststart mp4/bys-$cid.mp4
  echo "built mp4/bys-$cid.mp4"
done

echo "=== ffprobe ==="
for cid in cr03 cr06 cr09; do
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration,size -of default=noprint_wrappers=1 mp4/bys-$cid.mp4
  echo "---"
done
