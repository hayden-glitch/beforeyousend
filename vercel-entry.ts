// Vercel Build Output API function entry.
//
// The Build Output Node launcher invokes the default export as a classic Node
// `(req, res)` handler — NOT a web handler. TanStack Start emits a portable web
// fetch handler (dist/server/server.js), so we adapt: Node IncomingMessage → web
// Request, run the fetch handler, stream the web Response back onto ServerResponse.
// Node 22 has global Request/Response/Headers/ReadableStream.
//
// Bundled (with its deps + the SSR handler's dynamic ./assets chunks) into
// .vercel/output/functions/render.func/index.mjs by build-vercel.sh.
import type { IncomingMessage, ServerResponse } from "node:http";

import handler from "./dist/server/server.js";
import { handleApiRequest } from "./src/lib/server-api";

const fetchHandler = handler as {
  fetch: (request: Request) => Response | Promise<Response>;
};

const toWebRequest = (req: IncomingMessage): Request => {
  const host = req.headers.host ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, value);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    ...(hasBody
      ? { body: req as unknown as ReadableStream, duplex: "half" }
      : {}),
  } as RequestInit);
};

// ── Google tag gateway (first-party gtag proxy) ─────────────────────────────
// The browser loads gtag.js from OUR origin (/metrics/) and sends measurement
// + conversion pings to /metrics/... — this handler proxies those server-side
// to Google's first-party server (aw-18234635191.fps.goog) so ad blockers
// can't block the tag (they can't block our own domain). Analytics is
// non-fatal by design: any upstream failure returns a calm 502 and the rest
// of the site keeps working.
const FPS_HOST = "aw-18234635191.fps.goog";
const FPS_ORIGIN = `https://${FPS_HOST}`;

async function proxyMetrics(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.on("error", () => {}); // swallow post-destroy write errors
  try {
    const rawUrl = req.url ?? "/";
    const qIdx = rawUrl.indexOf("?");
    const path = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const search = qIdx === -1 ? "" : rawUrl.slice(qIdx);
    // "/metrics" and "/metrics/" both map to the fps root (which serves
    // gtag.js); "/metrics/..." maps 1:1 ("/metrics/g/collect" → "/g/collect").
    // fps root-relative beacons (/a — GTM container load telemetry, fired by
    // the fps-hosted gtag.js as an Image request to /a?v=3&t=l&pid=…; live QA
    // 2026-08-13 showed a 404 before this fix) pass through UNCHANGED — 1:1
    // to the fps host, which answers 200.
    let upstreamPath: string;
    if (path === "/metrics") upstreamPath = "/";
    else if (path.startsWith("/metrics/")) upstreamPath = path.slice("/metrics".length);
    else upstreamPath = path;
    const target = `${FPS_ORIGIN}${upstreamPath}${search}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower === "host") continue; // overridden below — fps.goog is virtual-hosted
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else if (value != null) headers.set(key, value);
    }
    headers.set("host", FPS_HOST);
    // Ask the fps server for the identity (uncompressed) representation:
    // Node's fetch auto-decompresses gzip/br bodies but LEAVES the
    // content-encoding header set — forwarding that verbatim would declare
    // plain JS as gzip (browsers fail to decode it; edge drops the body for
    // non-gzip clients). identity avoids the encoding dance entirely;
    // Vercel's edge re-compresses for browsers that accept it.
    headers.set("accept-encoding", "identity");
    // Geo signals: Vercel's IP-derived headers → Google's equivalents (GCP
    // sends X-Forwarded-CountryRegion; ours is the Vercel equivalent).
    const country = req.headers["x-vercel-ip-country"];
    if (typeof country === "string" && country) {
      headers.set("X-Forwarded-CountryRegion", country);
    }
    const city = req.headers["x-vercel-ip-city"];
    if (typeof city === "string" && city) {
      headers.set("X-Forwarded-Geolocation", `latlong=;city=${city}`);
    }

    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method,
        headers,
        // POST/GET both: stream the incoming body through (gtag collect pings
        // are POSTs; duplex:"half" is required for Node's fetch body streams).
        ...(hasBody ? { body: req as unknown as ReadableStream, duplex: "half" } : {}),
      } as RequestInit);
    } catch (error) {
      console.error("[metrics-proxy] upstream failure", error);
      res.statusCode = 502;
      res.setHeader("content-type", "text/plain");
      res.setHeader("cache-control", "no-store");
      res.end("Bad Gateway");
      return;
    }

    // Forward the upstream response verbatim — status, headers INCLUDING
    // Set-Cookie (the fps server's host-only cookies land on our first-party
    // origin; that's how gateway first-party attribution works), streamed body.
    res.statusCode = upstream.status;
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
    if (setCookies.length) res.setHeader("set-cookie", setCookies);
    // Strip the upstream encoding headers: with accept-encoding: identity the
    // body is already uncompressed, and content-length (if any) matches the
    // plain body. Defensive: if upstream ever compresses anyway, undici has
    // already decompressed the body, so declaring encoding/length would be
    // wrong — drop both.
    const hadContentEncoding = upstream.headers.has("content-encoding");
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "set-cookie") return;
      if (lower === "content-encoding") return;
      if (lower === "content-length" && hadContentEncoding) return;
      res.setHeader(key, value);
    });
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.destroyed) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error("[metrics-proxy] proxy failed", error);
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain");
    res.setHeader("cache-control", "no-store");
    res.end("Bad Gateway");
  }
}

export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // Legacy GTM beacon path: the first-party container was deleted (Round-3),
    // so nothing fetches /a anymore. A real visitor (or a stale cached beacon)
    // landing here previously got a blank 200 from the fps proxy — redirect to
    // the landing page instead. 307: temporary + method-preserving (the path
    // may be re-enabled with the gateway). Query string is preserved so ad
    // attribution (gclid/wbraid/gbraid) survives a landing on /a?... .
    const rawUrl = req.url ?? "/";
    const proxyPath = rawUrl.split("?")[0];
    if (proxyPath === "/a" || proxyPath.startsWith("/a/")) {
      const search = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
      res.statusCode = 307;
      res.setHeader("location", `/${search}`);
      res.setHeader("cache-control", "no-store");
      res.end();
      return;
    }
    // First-party tag gateway: /metrics/* still proxies to fps.goog (inert —
    // nothing fetches it today; kept as the re-enable point). No app route
    // uses /metrics, and /api/metrics/* (owner dashboard) does not collide.
    const isGateway =
      proxyPath === "/metrics" || proxyPath.startsWith("/metrics/");
    if (isGateway) {
      await proxyMetrics(req, res);
      return;
    }
    const webReq = toWebRequest(req);
    // Client-disconnect propagation: when the visitor's connection drops
    // mid-stream (tab closed, nav away, network blip), Node fires 'close' on
    // the ServerResponse BEFORE writableEnded. Abort the request-scoped signal
    // then — handleReview listens on it and aborts the LLM fetch, so an
    // abandoned review refunds its quota slot instead of completing server-side
    // unseen (and stops pinning the provider connection for the full timeout).
    const abortCtl = new AbortController();
    (webReq as unknown as { __bysSignal?: AbortSignal }).__bysSignal = abortCtl.signal;
    res.on("close", () => {
      if (!res.writableEnded) abortCtl.abort();
    });
    res.on("error", () => {}); // swallow post-destroy write errors
    const apiRes = await handleApiRequest(webReq);
    const webRes = apiRes ?? await fetchHandler.fetch(webReq);
    res.statusCode = webRes.status;
    // Set-Cookie must be handled separately: Node's setHeader() REPLACES on
    // repeat calls, so with two Set-Cookie headers only the last survives.
    // getSetCookie() returns each value individually (Headers.forEach/get
    // comma-join duplicates into one malformed header). Emit all as an array in
    // a single setHeader call → the browser receives both headers in order.
    const setCookies = typeof webRes.headers.getSetCookie === "function" ? webRes.headers.getSetCookie() : [];
    if (setCookies.length) res.setHeader("set-cookie", setCookies);
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      res.setHeader(key, value);
    });
    if (webRes.body) {
      const reader = webRes.body.getReader();
      let aborted = false;
      res.on("close", () => {
        if (!res.writableEnded) aborted = true;
      });
      for (;;) {
        let chunk: Uint8Array | null = null;
        try {
          const { done, value } = await reader.read();
          if (done) break;
          chunk = value;
        } catch {
          break; // source stream cancelled — stop writing
        }
        if (aborted || res.destroyed) break;
        res.write(chunk);
      }
    }
    res.end();
  } catch (error) {
    // Log the detail server-side (captured by the host's function logs); never
    // return a stack trace to the public visitor of the site.
    console.error("[team-site] SSR request failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
