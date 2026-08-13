// @ts-nocheck — Bun dev-harness (runtime types not in tsconfig; Stripe apiVersion
// pinned to the production SDK version, which lags the installed type defs).
// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";
import Stripe from "stripe";
import { handleApiRequest, getSession as apiGetSession } from "./src/lib/server-api";

// ---------------------------------------------------------------------------
// Before You Send API: POST /api/review (streaming NDJSON) and POST /api/save
// ---------------------------------------------------------------------------

type LLMConfig = { key: string; base: string; model: string };

function resolveLLM(): LLMConfig | null {
  const key =
    process.env.SAMBANOVA_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY;
  if (!key) return null;
  const isSamba = !!process.env.SAMBANOVA_API_KEY;
  const base = (process.env.LLM_BASE_URL ||
    (isSamba ? "https://api.sambanova.ai/v1" : "https://api.openai.com/v1")).replace(
    /\/+$/,
    ""
  );
  const model =
    process.env.LLM_MODEL ||
    (isSamba ? "Llama-4-Maverick-17B-128E-Instruct" : "gpt-4o-mini");
  return { key, base, model };
}

const llm = resolveLLM();
// Dev fallback: streams a sample review so the funnel is fully testable until a
// real key is added. Active ONLY when we are not running in production
// (NODE_ENV=production, e.g. the go-live deploy) and not explicitly disabled.
// Production without a key returns a clear error instead — never the fallback.
const isProd = process.env.NODE_ENV === "production";
const fallbackAllowed = !isProd && process.env.ALLOW_DEV_FALLBACK !== "0";
if (!llm && fallbackAllowed) {
  console.warn(
    "[review] No LLM key configured (SAMBANOVA_API_KEY / OPENAI_API_KEY / LLM_API_KEY) — using the DEV-ONLY sample fallback. Set a key to serve live reviews."
  );
} else if (!llm) {
  console.warn(
    "[review] No LLM key configured and NODE_ENV=production — /api/review will return an error until a key is set."
  );
}

// ---- In-memory result cache (hash of draft, ~10 min TTL) -------------------
const cache = new Map<string, { lines: string[]; exp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;
function cacheKey(draft: string): string {
  return Bun.hash(draft.trim().toLowerCase()).toString(36);
}
function cacheGet(key: string): string[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.lines;
}
function cacheSet(key: string, lines: string[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { lines, exp: Date.now() + CACHE_TTL_MS });
}

// ---- Review prompt ----------------------------------------------------------
const SYSTEM_PROMPT = `You are "Before You Send", a calm, practical communication coach for separated or divorced fathers in high-conflict co-parenting situations. A father has pasted a draft message he plans to send to his co-parent. Review it honestly and helpfully: show how it may be received, name the conflict risks, flag specific problematic language, preserve the facts that matter, and give three brief rewrites. You are NOT a lawyer and give NO legal advice. Never predict legal outcomes and never tell him what a judge or attorney will think.

Respond in EXACTLY this format, nothing before or after:

### HOW IT MAY BE RECEIVED
(a short, specific, realistic read on how the recipient will likely interpret the message: tone, subtext, what it may trigger. 1-3 sentences.)

### CONFLICT & ESCALATION RISKS
(2-4 short bullets. Name the specific risk and why: threats of court, ultimatums, personal attacks, blame, absolutes, re-litigating old fights, putting children in the middle.)

### WATCH OUT FOR
(2-5 short bullets. Quote the exact problematic phrase in "quotes", then name the pattern: emotional, accusatory, vague, threatening, defensive, unnecessary, absolutist, or manipulative. Be precise.)

### FACTS WORTH PRESERVING
(1-4 short bullets. The concrete, factual, useful information in the draft that should be kept: dates, logistics, specific requests. Do NOT invent facts that are not in the draft.)

### REWRITE: GENTLE
(1-3 sentences. Warm but not weak, cooperative, child-focused.)

### REWRITE: DIRECT
(1-3 sentences. Concise and matter-of-fact. States the request clearly. No apology spirals.)

### REWRITE: FIRM BUT NEUTRAL
(1-3 sentences. Sets a boundary or expectation firmly, without hostility or threats. Neutral, professional tone.)

Rules: every rewrite must be brief (under 40 words), plain English, specific to the real content of the draft, and never legalistic. Reframe courtroom threats as practical requests. Keep the children's wellbeing central. Never mention attorneys as advice, never claim to know what a court will do, never give legal advice. If the draft is already good, say so briefly in HOW IT MAY BE RECEIVED and keep the rewrites close to the original.

Draft to review:
`;

const SECTION_MAP: { re: RegExp; id: string; kind: "section" | "rewrite" }[] = [
  { re: /HOW IT MAY BE RECEIVED/i, id: "received", kind: "section" },
  { re: /CONFLICT.*ESCALATION RISKS/i, id: "risks", kind: "section" },
  { re: /WATCH OUT FOR/i, id: "watchout", kind: "section" },
  { re: /FACTS WORTH PRESERVING/i, id: "facts", kind: "section" },
  { re: /REWRITE:?\s*GENTLE/i, id: "gentle", kind: "rewrite" },
  { re: /REWRITE:?\s*DIRECT/i, id: "direct", kind: "rewrite" },
  { re: /REWRITE:?\s*FIRM/i, id: "firm", kind: "rewrite" },
];

const SECTION_TITLES: Record<string, string> = {
  received: "How it may be received",
  risks: "Conflict & escalation risks",
  watchout: "Watch out for",
  facts: "Facts worth preserving",
  gentle: "Gentle",
  direct: "Direct",
  firm: "Firm but Neutral",
};

function cleanLine(raw: string): { text: string; bullet: boolean } {
  let line = raw.trim();
  let bullet = false;
  // Strip markdown list markers and emphasis.
  if (/^[-*•]\s+/.test(line)) {
    bullet = true;
    line = line.replace(/^[-*•]\s+/, "");
  }
  line = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\*/g, "").trim();
  return { text: line, bullet };
}

/** Convert one model output line into zero-or-more NDJSON event lines. */
function modelLineToEvents(
  raw: string,
  state: { section: string | null; rewrite: string | null }
): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const header = SECTION_MAP.find((s) => s.re.test(trimmed.replace(/^#+\s*/, "")));
  if (header) {
    if (header.kind === "section") {
      state.section = header.id;
      state.rewrite = null;
      return [
        JSON.stringify({
          type: "section",
          id: header.id,
          title: SECTION_TITLES[header.id],
        }),
      ];
    }
    state.rewrite = header.id;
    state.section = null;
    return [
      JSON.stringify({ type: "rewrite", id: header.id, title: SECTION_TITLES[header.id] }),
    ];
  }
  const { text, bullet } = cleanLine(trimmed);
  if (!text) return [];
  if (state.rewrite) {
    return [JSON.stringify({ type: "rwtext", id: state.rewrite, text })];
  }
  if (state.section) {
    return [
      JSON.stringify({ type: bullet ? "item" : "para", id: state.section, text }),
    ];
  }
  return [JSON.stringify({ type: "para", id: "received", text })];
}

// ---- Dev-only sample fallback (clearly marked) ------------------------------
function fallbackEvents(draft: string): string[] {
  const opening = draft.trim().slice(0, 90);
  const quote = opening ? `"${opening}…"` : "the opening line";
  const lines = [
    `### HOW IT MAY BE RECEIVED`,
    `It starts with frustration, and ${quote} reads as an attack rather than a request. Your co-parent will likely go on the defensive before hearing anything else in the message.`,
    ``,
    `### CONFLICT & ESCALATION RISKS`,
    `- Threatening court or legal action can escalate the conflict and may look hostile if the messages ever surface.`,
    `- Words like "never" and "always" turn a specific issue into a sweeping accusation.`,
    `- Bringing the children into the argument risks putting them in the middle of the dispute.`,
    ``,
    `### WATCH OUT FOR`,
    `- "stop being so unreasonable" — accusatory`,
    `- "you never / you're always" — absolutist and vague`,
    `- "I'll have my attorney take you back to court" — threatening`,
    `- "everyone knows it" — vague and inflammatory`,
    ``,
    `### FACTS WORTH PRESERVING`,
    `- Your specific request about time with the kids (dates and times, if mentioned).`,
    `- Any prior arrangements or commitments that support your request.`,
    `- That you raised the issue without insults or threats.`,
    ``,
    `### REWRITE: GENTLE`,
    `Hi — I'd like to work out a schedule that gives me more time with the kids. Can we pick a day this week to talk about what works for both of us?`,
    ``,
    `### REWRITE: DIRECT`,
    `I'd like to agree on a regular schedule so I can see the kids consistently. Let me know a good time to discuss it.`,
    ``,
    `### REWRITE: FIRM BUT NEUTRAL`,
    `I'm available to discuss a consistent schedule for the kids. Please let me know a time this week that works for you — I'd like to settle this without further back-and-forth.`,
  ];
  const out: string[] = [];
  const state = { section: null as string | null, rewrite: null as string | null };
  for (const l of lines) out.push(...modelLineToEvents(l, state));
  return out;
}

// ---- Streaming helpers ------------------------------------------------------
function ndjson(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(lines.map((l) => l + "\n").join("")));
      controller.close();
    },
  });
}

async function* streamLLMEvents(draft: string): AsyncGenerator<string> {
  const res = await fetch(`${llm!.base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llm!.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: llm!.model,
      stream: true,
      temperature: 0.4,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: draft },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ? `: ${j.error.message}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`AI provider error (${res.status})${detail}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const state = { section: null as string | null, rewrite: null as string | null };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        const content = j.choices?.[0]?.delta?.content ?? "";
        if (!content) continue;
        const evs = modelLineToEvents(content, state);
        for (const ev of evs) yield ev;
      } catch {
        /* skip malformed SSE chunk */
      }
    }
  }
  const tail = modelLineToEvents(buf, state);
  for (const ev of tail) yield ev;
}

// ---- Request handlers -------------------------------------------------------
function json(res: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(res), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function streamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handleReview(req: Request): Promise<Response> {
  let body: { draft?: unknown };
  try {
    body = (await req.json()) as { draft?: unknown };
  } catch {
    return json({ error: "Send a JSON body with a draft." }, 400);
  }
  const draft = typeof body.draft === "string" ? body.draft.trim() : "";
  if (!draft) return json({ error: "Paste a message to review first." }, 400);
  if (draft.length > 5000)
    return json({ error: "That message is over 5,000 characters — try a shorter draft." }, 400);

  const key = cacheKey(draft);
  const cached = cacheGet(key);
  if (cached) {
    // Replay cached events with a small delay so the UI still streams.
    const lines = cached;
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "start", mode: llm ? "live" : "demo" }) + "\n"));
        for (const l of lines) {
          controller.enqueue(enc.encode(l + "\n"));
          await Bun.sleep(6);
        }
        controller.enqueue(enc.encode(JSON.stringify({ type: "done" }) + "\n"));
        controller.close();
      },
    });
    return streamResponse(stream);
  }

  if (!llm && !fallbackAllowed) {
    return json(
      {
        error:
          "Live review isn't configured yet — an AI provider key is required. This is a temporary setup issue, not a problem with your message.",
      },
      503
    );
  }

  const mode: "live" | "demo" = llm ? "live" : "demo";
  const enc = new TextEncoder();
  const collected: string[] = [];
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(JSON.stringify({ type: "start", mode }) + "\n"));
      try {
        let gen: AsyncGenerator<string>;
        if (llm) {
          gen = streamLLMEvents(draft);
        } else {
          const events = fallbackEvents(draft);
          gen = (async function* () {
            for (const ev of events) {
              yield ev;
              await Bun.sleep(14);
            }
          })();
        }
        for await (const ev of gen) {
          collected.push(ev);
          controller.enqueue(enc.encode(ev + "\n"));
        }
        controller.enqueue(enc.encode(JSON.stringify({ type: "done" }) + "\n"));
        cacheSet(key, collected);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "The review failed. Please try again.";
        controller.enqueue(
          enc.encode(JSON.stringify({ type: "error", message }) + "\n")
        );
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return streamResponse(stream);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SIGNOUPS_FILE = "/home/team/shared/bys-signups.jsonl";

async function handleSave(req: Request): Promise<Response> {
  let body: { email?: unknown; draft?: unknown; review?: unknown };
  try {
    body = (await req.json()) as { email?: unknown; draft?: unknown; review?: unknown };
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "That email address doesn't look right." }, 400);
  }
  const draft = typeof body.draft === "string" ? body.draft.slice(0, 5000) : "";
  const review = typeof body.review === "string" ? body.review.slice(0, 12000) : "";

  const row = {
    ts: new Date().toISOString(),
    email,
    draft,
    review,
  };

  try {
    if (process.env.DATABASE_URL) {
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL);
      await sql`
        CREATE TABLE IF NOT EXISTS bys_signups (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT now(),
          email TEXT NOT NULL,
          draft TEXT,
          review TEXT
        )`;
      await sql`
        INSERT INTO bys_signups (email, draft, review)
        VALUES (${row.email}, ${row.draft || null}, ${row.review || null})`;
    } else {
      await Bun.write(SIGNOUPS_FILE, JSON.stringify(row) + "\n", {
        createPath: true,
        append: true,
      });
    }
    const confirmToken = token();
    confirmTokens.set(confirmToken, { email, exp: Date.now() + 30 * 60 * 1000 });
    const confirmResult = await sendConfirmation(email, `${new URL(req.url).origin}/confirm?token=${confirmToken}`);
    if (confirmResult.error) return json({ error: confirmResult.error }, 503);
    return json({ ok: true, next: "confirm", sent: confirmResult.sent, ...(confirmResult.sent ? {} : { link: confirmResult.link }) });
  } catch (err) {
    console.error("[review] save failed:", err);
    return json({ error: "Couldn't save right now — please try again." }, 500);
  }
}

// ---------------------------------------------------------------------------
// Lightweight auth store (JSON, with Neon-compatible deployments still using file
// storage for this early funnel). Passwords are scrypt hashes; sessions are signed.
// ---------------------------------------------------------------------------
const USERS_FILE = "/home/team/shared/bys-users.json";
const AUTH_SECRET = process.env.AUTH_SECRET || "bys-dev-secret-change-me";
const confirmTokens = new Map<string, { email: string; exp: number }>();
const sessions = new Map<string, { userId: string; exp: number }>();
const authJson = (data: unknown, status = 200, headers: Record<string,string> = {}) => json(data, status, headers);
async function readUsers(): Promise<any[]> { try { return (await Bun.file(USERS_FILE).json()) as any[]; } catch { return []; } }
async function writeUsers(users: any[]) { await Bun.write(USERS_FILE, JSON.stringify(users, null, 2), { createPath: true }); }
function token(n = 32) { return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, n - 32); }
async function hashPassword(password: string, salt = crypto.randomUUID()) { const { scrypt } = await import("node:crypto"); return new Promise<string>((resolve, reject) => scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`scrypt:${salt}:${Buffer.from(key).toString("hex")}`))); }
async function verifyPassword(password: string, stored: string) { const { scrypt, timingSafeEqual } = await import("node:crypto"); const [, salt, expected] = stored.split(":"); return new Promise<boolean>((resolve) => scrypt(password, salt, 64, (err, key) => { if (err) return resolve(false); const actual = Buffer.from(key).toString("hex"); resolve(actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))); })); }
function cookie(name: string, value: string, maxAge: number) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function getSession(req: Request) { const raw = req.headers.get("cookie"); const toks: string[] = []; if (raw) { for (const part of raw.split(";")) { const eq = part.indexOf("="); if (eq > 0 && part.slice(0, eq).trim() === "bys_session") toks.push(part.slice(eq + 1).trim()); } } for (const t of toks) { const s = sessions.get(t); if (!s || s.exp < Date.now()) { if (s) sessions.delete(t); continue; } return { ...s, token: t }; } return null; }
async function sendConfirmation(email: string, link: string) {
  const key = process.env.EMAIL_API_KEY;
  if (!key) { if (process.env.NODE_ENV === "production") return { sent: false, error: "Email delivery is not configured." }; console.log(`[mailer] Confirmation link for ${email}: ${link}`); return { sent: false, link }; }
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM || "Before You Send <no-reply@beforeyousend.app>", to: [email], subject: "Confirm your Before You Send account", html: `<p>Confirm your account: <a href="${link}">Set your password</a></p>` }) });
  if (!res.ok) return { sent: false, error: "Email provider rejected the message." }; return { sent: true };
}
async function handleConfirmLink(req: Request): Promise<Response> {
  let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  const t = token(); confirmTokens.set(t, { email, exp: Date.now() + 30 * 60 * 1000 });
  const link = `${new URL(req.url).origin}/confirm?token=${t}`;
  const result = await sendConfirmation(email, link);
  if (result.error) return json({ error: result.error }, 503);
  return json({ ok: true, sent: result.sent, ...(result.sent ? {} : { link }) });
}
// Email-only account confirmation (use-first funnel): a valid confirm token
// creates the account and signs the visitor in WITHOUT a password — the /confirm
// password wall is deferred/optional (owner 2026-08-10). Password users keep
// handlePassword/login; passwordless users sign in later via the link flow.
async function handleConfirm(req: Request): Promise<Response> {
  let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const t = typeof body.token === "string" ? body.token : "";
  const pending = confirmTokens.get(t);
  if (!pending || pending.exp < Date.now()) return json({ error: "This confirmation link is invalid or expired." }, 400);
  const users = await readUsers(); let user = users.find(u => u.email === pending.email);
  if (!user) { user = { id: crypto.randomUUID(), email: pending.email, createdAt: new Date().toISOString(), profile: {} }; users.push(user); }
  user.confirmedAt = new Date().toISOString(); await writeUsers(users); confirmTokens.delete(t);
  const st = token(); sessions.set(st, { userId: user.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  return json({ ok: true, user: { id: user.id, email: user.email, profile: user.profile } }, 200, { "Set-Cookie": cookie("bys_session", st, 30 * 24 * 3600) });
}
async function handlePassword(req: Request): Promise<Response> {
  let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const t = typeof body.token === "string" ? body.token : ""; const password = typeof body.password === "string" ? body.password : "";
  const pending = confirmTokens.get(t); if (!pending || pending.exp < Date.now()) return json({ error: "This confirmation link is invalid or expired." }, 400);
  if (password.length < 8) return json({ error: "Use at least 8 characters." }, 400);
  const users = await readUsers(); let user = users.find(u => u.email === pending.email);
  if (!user) { user = { id: crypto.randomUUID(), email: pending.email, createdAt: new Date().toISOString(), profile: {} }; users.push(user); }
  user.password = await hashPassword(password); user.confirmedAt = new Date().toISOString(); await writeUsers(users); confirmTokens.delete(t);
  const st = token(); sessions.set(st, { userId: user.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  return json({ ok: true, user: { id: user.id, email: user.email, profile: user.profile } }, 200, { "Set-Cookie": cookie("bys_session", st, 30 * 24 * 3600) });
}
async function handleLogin(req: Request): Promise<Response> { let b:any; try { b=await req.json(); } catch { return json({error:"Invalid request."},400); } const users=await readUsers(); const u=users.find(x=>x.email===String(b.email||"").trim().toLowerCase()); if(!u || !u.password || !(await verifyPassword(String(b.password||""),u.password))) return json({error:"Email or password is incorrect."},401); const st=token(); sessions.set(st,{userId:u.id,exp:Date.now()+30*24*3600*1000}); return json({ok:true,user:{id:u.id,email:u.email,profile:u.profile}},200,{"Set-Cookie":cookie("bys_session",st,30*24*3600)}); }
async function authMe(req: Request) { const s=getSession(req); if(!s) return json({user:null},401); const u=(await readUsers()).find(x=>x.id===s.userId); return u ? json({user:{id:u.id,email:u.email,profile:u.profile}}) : json({user:null},401); }
async function authLogout(req: Request) { const s=getSession(req); if(s) sessions.delete(s.token); return json({ok:true},200,{"Set-Cookie":cookie("bys_session","",0)}); }
const REVIEWS_FILE = "/home/team/shared/bys-reviews.json";
const LOG_FILE = "/home/team/shared/bys-log.json";
async function readLog(): Promise<any[]> { try { return (await Bun.file(LOG_FILE).json()) as any[]; } catch { return []; } }
async function handleLog(req: Request, method: string, id?: string): Promise<Response> {
const s = getSession(req); if (!s) return json({error:"Sign in required."},401);
const users = await readUsers(), u = users.find(x => x.id === s.userId); if (!u) return json({error:"Account not found."},404);
const all = await readLog();
if (method === "GET") return json({logs: all.filter(x => x.userId === u.id).sort((a,b) => String(b.date).localeCompare(String(a.date))) });
if (method === "DELETE") { const next = all.filter(x => !(x.userId === u.id && x.id === id)); await Bun.write(LOG_FILE, JSON.stringify(next,null,2), {createPath:true}); return json({ok:true}); }
let b:any; try { b = await req.json(); } catch { return json({error:"Invalid request."},400); }
if (method === "PATCH" || method === "PUT") {
  const row = all.find(x => x.userId === u.id && x.id === id); if (!row) return json({error:"Entry not found."},404);
  if (typeof b.message === "string") row.message = b.message.slice(0,10000); if (b.direction === "sent" || b.direction === "received") row.direction = b.direction;
  if (typeof b.date === "string" && b.date) row.date = b.date; if (typeof b.topic === "string") row.topic = b.topic.slice(0,80); if (typeof b.notes === "string") row.notes = b.notes.slice(0,5000);
  row.updatedAt = new Date().toISOString(); await Bun.write(LOG_FILE, JSON.stringify(all,null,2), {createPath:true}); return json({ok:true, log:row});
}
const message = typeof b.message === "string" ? b.message.trim().slice(0,10000) : ""; if (!message) return json({error:"Message text is required."},400);
const row = {id:crypto.randomUUID(), userId:u.id, message, direction:b.direction === "received" ? "received" : "sent", date:typeof b.date === "string" && b.date ? b.date : new Date().toISOString(), topic:typeof b.topic === "string" ? b.topic.slice(0,80) : "other", notes:typeof b.notes === "string" ? b.notes.slice(0,5000) : "", createdAt:new Date().toISOString()};
all.push(row); await Bun.write(LOG_FILE, JSON.stringify(all,null,2), {createPath:true}); return json({ok:true, log:row},201);
}
async function readReviews(): Promise<any[]> { try { return (await Bun.file(REVIEWS_FILE).json()) as any[]; } catch { return []; } }
async function handleReviews(req: Request, method: string): Promise<Response> {
  const s=getSession(req); if(!s) return json({error:"Sign in required."},401);
  const users=await readUsers(), u=users.find(x=>x.id===s.userId); if(!u) return json({error:"Account not found."},404);
  const all=await readReviews();
  if(method==="GET") {
    let own=all.filter(x=>x.userId===u.id);
    try { const lines=(await Bun.file(SIGNOUPS_FILE).text()).trim().split("\n").filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.email===u.email); own=[...own,...lines.map(x=>({id:`landing-${x.ts}`,userId:u.id,draft:x.draft,blocks:[],review:x.review,createdAt:x.ts,landing:true}))]; } catch {}
    return json({reviews:own.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))});
  }
  let b:any; try{b=await req.json()}catch{return json({error:"Invalid request."},400)}
  if(method==="DELETE"){const next=all.filter(x=>!(x.userId===u.id&&x.id===b.id));await Bun.write(REVIEWS_FILE,JSON.stringify(next,null,2),{createPath:true});return json({ok:true});}
  const row={id:crypto.randomUUID(),userId:u.id,draft:String(b.draft||"").slice(0,5000),blocks:Array.isArray(b.blocks)?b.blocks.slice(0,200):[],review:String(b.review||"").slice(0,12000),createdAt:new Date().toISOString()}; all.push(row); await Bun.write(REVIEWS_FILE,JSON.stringify(all,null,2),{createPath:true}); return json({ok:true,review:row});
}
async function handleProfile(req: Request) { const s=getSession(req); if(!s) return json({error:"Sign in required."},401); let b:any; try{b=await req.json();}catch{return json({error:"Invalid request."},400)} const users=await readUsers(); const u=users.find(x=>x.id===s.userId); if(!u)return json({error:"Account not found."},404); u.profile={name:String(b.name||"").slice(0,100),situation:Array.isArray(b.situation)?b.situation.slice(0,10):[], help:Array.isArray(b.help)?b.help.slice(0,10):[], completed:true}; await writeUsers(users); return json({ok:true,user:{id:u.id,email:u.email,profile:u.profile}}); }

// ---------------------------------------------------------------------------
// Stripe Checkout. Prices are created lazily from env-configured cents.
// ---------------------------------------------------------------------------
const subscriptionCents = Number(process.env.PRICE_SUBSCRIPTION_USD_CENTS || 2499);
const consultationCents = Number(process.env.PRICE_CONSULTATION_USD_CENTS || 14900);
const stripePrices = new Map<string, string>();
async function handleCheckout(req: Request): Promise<Response> {
  if (!process.env.STRIPE_SECRET_KEY) return json({ error: "Payments are not enabled yet — checkout will be active soon." }, 503);
  let body: any; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const plan = body?.plan;
  if (plan !== "subscription" && plan !== "consultation") return json({ error: "Choose a valid plan." }, 400);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
  const recurring = plan === "subscription";
  let priceId = stripePrices.get(plan);
  if (!priceId) {
    const price = await stripe.prices.create({ currency: "usd", unit_amount: recurring ? subscriptionCents : consultationCents, ...(recurring ? { recurring: { interval: "month" } } : {}), product_data: { name: recurring ? "Before You Send Monthly" : "Before You Send Consultation" } } as any);
    priceId = price.id; stripePrices.set(plan, priceId);
  }
  const origin = new URL(req.url).origin;
  const session = await stripe.checkout.sessions.create({ mode: recurring ? "subscription" : "payment", line_items: [{ price: priceId, quantity: 1 }], managed_payments: { enabled: false }, success_url: `${origin}/pricing?checkout=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/pricing?checkout=cancelled` });
  return json({ url: session.url });
}

// ---------------------------------------------------------------------------
// Server bootstrap (unchanged behavior: port takeover, static files, SSR)
// ---------------------------------------------------------------------------

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;
// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;
// Take over the port, re-freeing and retrying if another publish grabbed it in the
// gap between freeing and binding (last publish wins). Bun.serve throws EADDRINUSE
// synchronously, so without this a raced publish would die while the shell already
// reported success.
for (let attempt = 1; ; attempt++) {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        const method = req.method;
        const apiResponse = await handleApiRequest(req);
        if (apiResponse) return apiResponse;
        if ((pathname === "/home" || pathname === "/onboarding") && !apiGetSession(req)) return Response.redirect(new URL("/", req.url), 302);

        if (pathname === "/api/checkout" && method === "POST") return handleCheckout(req);
        if (pathname === "/api/review" && method === "POST") {
          return handleReview(req);
        }
        if (pathname === "/api/save" && method === "POST") {
          return handleSave(req);
        }
        if (pathname === "/api/auth/confirm-link" && method === "POST") return handleConfirmLink(req);
        if (pathname === "/api/auth/confirm" && method === "POST") return handleConfirm(req);
        if (pathname === "/api/auth/password" && method === "POST") return handlePassword(req);
        if (pathname === "/api/auth/login" && method === "POST") return handleLogin(req);
        if (pathname === "/api/auth/logout" && method === "POST") return authLogout(req);
        if (pathname === "/api/auth/me" && method === "GET") return authMe(req);
        if (pathname === "/api/auth/profile" && method === "POST") return handleProfile(req);
        if (pathname === "/api/reviews" && (method === "GET" || method === "POST" || method === "DELETE")) return handleReviews(req, method);
        if (pathname === "/api/log" && (method === "GET" || method === "POST")) return handleLog(req, method);
        const logMatch = pathname.match(/^\/api\/log\/([^/]+)$/);
        if (logMatch && (method === "PATCH" || method === "PUT" || method === "DELETE")) return handleLog(req, method, logMatch[1]);

        if (pathname !== "/") {
          const file = Bun.file(CLIENT_DIR + pathname);
          if (await file.exists()) return new Response(file);
        }
        return (
          handler as { fetch: (r: Request) => Response | Promise<Response> }
        ).fetch(req);
      },
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}
console.log(`team-site serving on http://${HOST}:${String(PORT)}`);
console.log(
  llm
    ? `[review] AI provider configured: ${llm.base} (model ${llm.model})`
    : `[review] No AI provider key — ${fallbackAllowed ? "DEV fallback active" : "reviews disabled until a key is set"}`
);
