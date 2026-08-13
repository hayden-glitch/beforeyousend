#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this site, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Why Build Output API instead of Vercel's Vite/framework detection:
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained file (deps + dynamic chunks inlined) in a
#    single render.func removes all tracing/detection risk. vercel-entry.ts adapts
#    the Node (req,res) launcher to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002
# Bake VITE_* build-time vars (Google Ads conversion labels etc.) into the vite
# bundle. Previously build-vercel.sh never sourced .env, so import.meta.env.VITE_*
# values were always empty at build time and the labels never reached the live
# bundle (found live 2026-08-11: VITE_GOOGLE_CV_EMAIL absent from deployed JS).
# Sourcing here exports every .env var for the build; vite only inlines the
# VITE_-prefixed ones, and server runtime env (DATABASE_URL etc.) stays a live
# process.env read — nothing sensitive is baked into the bundle.
set -a; . ./.env 2>/dev/null || true; set +a
echo "[1/3] vite build (light — safe under the sandbox memory cap)"
# The workspace starts as sources only (deps live with the image's pre-built
# placeholder copy); no-op once node_modules is current.
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[3/3] bundle SSR handler + deps into the render function"
# pdfjs-dist + jszip are CLIENT-ONLY (Sort My Pile on-device extraction): bun
# would otherwise inline them into the server function (~1.3MB of dead weight
# the SSR bundle never uses). External keeps the function lean; the dynamic
# imports inside extract.ts are only ever evaluated in the browser.
bun build vercel-entry.ts --target node \
  --external jszip --external pdfjs-dist \
  --outfile .vercel/output/functions/render.func/index.mjs

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true, "maxDuration": 60 }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
