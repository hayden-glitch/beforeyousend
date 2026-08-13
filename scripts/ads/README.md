# TikTok video ad creatives (cr03 / cr06 / cr09)

Produced 2026-08-09 (full-stack engineer session). 1080x1920 portrait MP4, H.264,
~30fps, 7.6s, silent, <1.3MB each. Built from HTML frames (headless Chrome) +
ffmpeg zoompan Ken Burns + crossfades. NO people, NO banned words, headline copy
verbatim from copy-final.md section 4, text rendered programmatically (never AI
image generation).

## Files
- `gen.py` — generates `frames/<id>/beat{1,2,3}.html` (1080x1920). `--guides` adds
  TikTok overlay safe-zone guides + a `<pre id="report">` DOM-measure block.
- `render.sh` — headless Chrome screenshot of each frame (needs a static server;
  see Rebuild). Chrome binary: `/root/.agent-browser/browsers/chrome-151.0.7922.76/chrome`
  or any headless Chromium. Screenshot flags:
  `--headless=new --no-sandbox --disable-gpu --hide-scrollbars
   --force-device-scale-factor=1 --window-size=1080,1920 --virtual-time-budget=6000`.
- `build.sh` — ffmpeg: per-beat zoompan segment (pre-scale 1350x2400, d=102/81/81)
  then xfade 0.6s crossfades (offsets 2.8 / 4.9) -> total 7.6s; silent, crf 20.
- `frames/` — the 9 final HTML frame sources.
- `fonts/` — Inter 400/600 (variable font, same woff2) + site Fraunces 600 woff2.
- Output MP4s live at `site/public/ads/bys-{cr03,cr06,cr09}.mp4` (served) and
  `/home/team/shared/ads/` (archive).

## Rebuild
```
cd /home/team/shared/site/scripts/ads
python3 gen.py            # final frames (no guides); gen.py --guides for QA
python3 -m http.server 8911 &   # serve this dir, then:
bash render.sh            # writes png/ (needs CHROME var, edit render.sh)
bash build.sh             # writes mp4/ + ffprobe summary
```

## Verification (definition of done)
- ffprobe: 1080x1920, h264, 30fps, 7.6s, no audio stream, ~1.2MB.
- OCR (tesseract) of rendered PNGs + frames extracted from the MP4s confirms the
  exact headlines: "You don't have to answer hot." / "Know how it reads before
  it's sent." / "Keep it calm, for the kids."
- Safe zones: all content within x<=830 (right 250px clear) and y<=1600 (bottom
  320px clear); logo lockup bottom-left; headline band y 310-491.
- Banned-word scan (divorced/custody/your ex/fathers/win/co-parenting/dad/court/
  lawyer/judge/gavel/battle + standalone "ex") on all frames: clean.
- "Free" appears only as "First review free. No account." (true: first review
  always free).
