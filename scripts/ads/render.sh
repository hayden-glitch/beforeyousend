#!/usr/bin/env bash
set -e
CHROME=/root/.agent-browser/browsers/chrome-151.0.7922.76/chrome
OUT=/tmp/adsrc/png
mkdir -p "$OUT"
for cid in cr03 cr06 cr09; do
  for b in 1 2 3; do
    "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
      --force-device-scale-factor=1 --window-size=1080,1920 \
      --virtual-time-budget=6000 \
      --screenshot="$OUT/$cid-b$b.png" \
      "http://127.0.0.1:8911/frames/$cid/beat$b.html" >/dev/null 2>&1 || echo "FAIL $cid b$b"
  done
done
echo done
ls -la "$OUT" | awk '{print $5, $9}'
