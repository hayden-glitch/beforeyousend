#!/usr/bin/env node
// analyze-png.mjs — semantic PNG comparison without image tooling.
// Prints {w,h,darkPct,tileDiff} between two PNGs (16x16 avg-luminance tiles).
// Usage: node analyze-png.mjs <a.png> <b.png>
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
function sig(p) {
  const b = readFileSync(p);
  let off = 8, w = 0, h = 0; const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off), type = b.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") { w = b.readUInt32BE(off + 8); h = b.readUInt32BE(off + 12); }
    if (type === "IDAT") idat.push(b.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = line[x], pr = prev[x], pa = x >= bpp ? line[x - bpp] : 0, pp = x >= bpp ? prev[x - bpp] : 0;
      let v = a;
      if (f === 1) v = (a + pr) & 255;
      else if (f === 2) v = (a + pa) & 255;
      else if (f === 3) v = (a + ((pr + pa) >> 1)) & 255;
      else if (f === 4) { const p = pr + pa - pp; const pa2 = Math.abs(p - pr), pb = Math.abs(p - pa), pc = Math.abs(p - pp); v = (a + (pa2 <= pb && pa2 <= pc ? pr : pb <= pc ? pa : pp)) & 255; }
      out[y * stride + x] = v; if (x >= bpp) line[x] = v;
    }
    prev = line;
  }
  const tw = 16, th = 16; const tiles = new Array(tw * th).fill(0); const cnt = new Array(tw * th).fill(0);
  let dark = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const lum = (out[i] * 0.299 + out[i + 1] * 0.587 + out[i + 2] * 0.114);
    const tx = Math.min(tw - 1, Math.floor(x / w * tw)), ty = Math.min(th - 1, Math.floor(y / h * th));
    tiles[ty * tw + tx] += lum; cnt[ty * tw + tx]++;
    if (lum < 60) dark++;
  }
  for (let i = 0; i < tw * th; i++) tiles[i] = Math.round(tiles[i] / cnt[i]);
  return { w, h, darkPct: +(dark / (w * h) * 100).toFixed(1), tiles: tiles.join(",") };
}
const a = process.argv[2], b = process.argv[3];
const sa = sig(a), sb = sig(b);
let diff = 0; const ta = sa.tiles.split(","), tb = sb.tiles.split(",");
for (let i = 0; i < ta.length; i++) diff += Math.abs(+ta[i] - +tb[i]);
console.log(JSON.stringify({
  a: `${sa.w}x${sa.h} dark${sa.darkPct}%`, b: `${sb.w}x${sb.h} dark${sb.darkPct}%`,
  tileDiff: diff, verdict: diff > 40 ? "DIFFERENT" : (diff > 12 ? "SUBTLE" : "NEAR-IDENTICAL"),
}));
