import { neon } from "@neondatabase/serverless";
const base = "/home/team/shared";
const files = { users: `${base}/bys-users.json`, reviews: `${base}/bys-reviews.json`, log: `${base}/bys-log.json`, timeline: `${base}/bys-timeline.json`, signups: `${base}/bys-signups.jsonl`, anon: `${base}/bys-anon.json`, sessions: `${base}/bys-sessions.json`, authSessions: `${base}/bys-auth-sessions.json`, confirmTokens: `${base}/bys-confirm-tokens.json`, events: `${base}/bys-events.json`, organizerFiles: `${base}/bys-organizer-files.json`, organizerTrials: `${base}/bys-organizer-trials.json`, caseSummary: `${base}/bys-case-summaries.json`, actionCenter: `${base}/bys-action-center.json`, reviewEvents: `${base}/bys-review-events.json`, sessionPlay: `${base}/bys-session-play.json`, tiktokTokens: `${base}/bys-tiktok-tokens.json`, tiktokPublishes: `${base}/bys-tiktok-publishes.json`, giftCodes: `${base}/bys-gift-codes.json`, consultations: `${base}/bys-consultations.json`, attorneyPacks: `${base}/bys-attorney-packs.json`, organizerUsage: `${base}/bys-organizer-usage.json`, trials: `${base}/bys-trials.json` };
const db = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
let boot: Promise<void> | null = null;
async function init(){ const sql=db(); if(!sql)return; await Promise.all([
 sql`CREATE TABLE IF NOT EXISTS bys_users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),confirmed_at TIMESTAMPTZ,profile JSONB NOT NULL DEFAULT '{}'::jsonb)`,
 sql`CREATE TABLE IF NOT EXISTS bys_signups (id BIGSERIAL PRIMARY KEY,ts TIMESTAMPTZ NOT NULL DEFAULT now(),email TEXT NOT NULL,draft TEXT,review TEXT)`,
 sql`CREATE TABLE IF NOT EXISTS bys_reviews (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,draft TEXT,blocks JSONB NOT NULL DEFAULT '[]'::jsonb,review TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 sql`CREATE TABLE IF NOT EXISTS bys_log (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,message TEXT NOT NULL,direction TEXT,date TEXT,topic TEXT,notes TEXT,child TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ)`,
 sql`CREATE TABLE IF NOT EXISTS bys_timeline (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,date TEXT,title TEXT,category TEXT,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ)`,
 sql`CREATE TABLE IF NOT EXISTS bys_sessions (vid TEXT PRIMARY KEY,first_ts TIMESTAMPTZ NOT NULL DEFAULT now(),last_ts TIMESTAMPTZ NOT NULL DEFAULT now(),referrer TEXT,ua TEXT,entry_path TEXT,exit_path TEXT,landing_path TEXT,pageviews INT NOT NULL DEFAULT 0,source TEXT,medium TEXT,campaign TEXT,gclid TEXT,gbraid TEXT,wbraid TEXT,ttclid TEXT)`,
 sql`CREATE TABLE IF NOT EXISTS bys_events (id BIGSERIAL PRIMARY KEY,vid TEXT NOT NULL,ts TIMESTAMPTZ NOT NULL DEFAULT now(),name TEXT NOT NULL,plan TEXT,meta JSONB NOT NULL DEFAULT '{}'::jsonb)`,
 sql`CREATE TABLE IF NOT EXISTS bys_auth_sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL,exp BIGINT NOT NULL)`,
 sql`CREATE TABLE IF NOT EXISTS bys_confirm_tokens (token TEXT PRIMARY KEY,email TEXT NOT NULL,exp BIGINT NOT NULL,purpose TEXT NOT NULL DEFAULT 'signup',delivered BOOLEAN NOT NULL DEFAULT FALSE,vid TEXT)`,
 sql`CREATE TABLE IF NOT EXISTS bys_session_play (id BIGSERIAL PRIMARY KEY,vid TEXT NOT NULL,ts TIMESTAMPTZ NOT NULL DEFAULT now(),kind TEXT NOT NULL DEFAULT 'event',name TEXT,dt INT,t INT,depth_pct INT,path TEXT,meta JSONB NOT NULL DEFAULT '{}'::jsonb)`,
 sql`CREATE TABLE IF NOT EXISTS bys_tiktok_tokens (id TEXT PRIMARY KEY,access_token TEXT NOT NULL,refresh_token TEXT,open_id TEXT,scope TEXT,expires_at BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 sql`CREATE TABLE IF NOT EXISTS bys_tiktok_publishes (id BIGSERIAL PRIMARY KEY,publish_id TEXT,video_url TEXT,caption TEXT,status TEXT,api_status TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 sql`CREATE TABLE IF NOT EXISTS bys_user_review_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))`,
 sql`CREATE TABLE IF NOT EXISTS bys_case_summary (user_id TEXT PRIMARY KEY, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), text TEXT NOT NULL, data_version TEXT)`,
 sql`CREATE TABLE IF NOT EXISTS bys_action_center (user_id TEXT PRIMARY KEY, generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), items JSONB NOT NULL DEFAULT '[]'::jsonb, data_version TEXT)`,
 sql`CREATE TABLE IF NOT EXISTS bys_review_events (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,review_id TEXT,draft_hash TEXT,score INT NOT NULL,flags JSONB NOT NULL DEFAULT '{}'::jsonb,sent_status TEXT,sent_tone TEXT,sent_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 sql`CREATE TABLE IF NOT EXISTS bys_gift_codes (id TEXT PRIMARY KEY,giver_id TEXT NOT NULL,months INT NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'active',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),redeemed_by TEXT,redeemed_at TIMESTAMPTZ,session_id TEXT UNIQUE)`,
 sql`CREATE TABLE IF NOT EXISTS bys_organizer_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))`,
 sql`CREATE TABLE IF NOT EXISTS bys_consultations (id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,email TEXT,amount_cents INT NOT NULL DEFAULT 0,session_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
 sql`CREATE TABLE IF NOT EXISTS bys_attorney_packs (id BIGSERIAL PRIMARY KEY,user_id TEXT NOT NULL,email TEXT,amount_cents INT NOT NULL DEFAULT 0,session_id TEXT UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
sql`CREATE TABLE IF NOT EXISTS bys_trials (user_id TEXT PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL,source TEXT)`,
 sql`CREATE INDEX IF NOT EXISTS bys_events_name_ts ON bys_events(name,ts)`,
 sql`CREATE INDEX IF NOT EXISTS bys_events_vid_ts ON bys_events(vid,ts)`]);
  // Run AFTER the parallel table batch: the index depends on its table, and the
  // parallel batch can race (index arriving before CREATE TABLE -> init rejects
  // and poisons the cached boot promise, 500ing every storage call).
  try { await sql`CREATE INDEX IF NOT EXISTS bys_auth_sessions_user ON bys_auth_sessions(user_id)` } catch (err) { console.warn("[storage] auth_sessions index:", err) }
  // Confirm-token schema additions (purpose/delivered/vid) for databases that
  // already have the table from before the in-app-confirm restore: ALTERs must
  // run AFTER the parallel CREATE TABLE batch (same race rule as the indexes),
  // and be idempotent so fresh DBs (which get the full columns from the CREATE
  // TABLE) are untouched.
  try { await sql`ALTER TABLE bys_confirm_tokens ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'signup'` } catch (err) { console.warn("[storage] confirm_tokens purpose:", err) }
  try { await sql`ALTER TABLE bys_confirm_tokens ADD COLUMN IF NOT EXISTS delivered BOOLEAN NOT NULL DEFAULT FALSE` } catch (err) { console.warn("[storage] confirm_tokens delivered:", err) }
  try { await sql`ALTER TABLE bys_confirm_tokens ADD COLUMN IF NOT EXISTS vid TEXT` } catch (err) { console.warn("[storage] confirm_tokens vid:", err) }
  // Metrics attribution (2026-08-11): bys_sessions.landing_path persists the
  // FIRST page_view's real URL (with gad_source/gclid/ttclid) — entry_path
  // stays the /api/events beacon path. Idempotent; after the parallel CREATE
  // TABLE batch (same race rule as the indexes above).
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS landing_path TEXT` } catch (err) { console.warn("[storage] sessions landing_path:", err) }
  // Conversion-tracking Fix 4 (audit 85fbc48d): bys_sessions gains its own
  // attribution columns (source/medium/campaign + the paid-traffic IDs). Set
  // first-write-wins from the FIRST page_view; never overwritten later (Direct
  // after login must not replace Google). Idempotent; after the parallel CREATE
  // TABLE batch (same race rule as the indexes above).
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS source TEXT` } catch (err) { console.warn("[storage] sessions source:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS medium TEXT` } catch (err) { console.warn("[storage] sessions medium:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS campaign TEXT` } catch (err) { console.warn("[storage] sessions campaign:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS gclid TEXT` } catch (err) { console.warn("[storage] sessions gclid:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS gbraid TEXT` } catch (err) { console.warn("[storage] sessions gbraid:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS wbraid TEXT` } catch (err) { console.warn("[storage] sessions wbraid:", err) }
  try { await sql`ALTER TABLE bys_sessions ADD COLUMN IF NOT EXISTS ttclid TEXT` } catch (err) { console.warn("[storage] sessions ttclid:", err) }
  // Calm-loop slice 1: bys_log gains an optional tone column (gentle|direct|
  // firm|as-wrote|reviewed — set only by the did-you-send loop, never the Add
  // form), and bys_review_events gets its (user_id, created_at) index for the
  // week-count + last-3 queries. Both run AFTER the parallel CREATE TABLE batch
  // (same race rule as the indexes above) and are idempotent.
  try { await sql`ALTER TABLE bys_log ADD COLUMN IF NOT EXISTS tone TEXT` } catch (err) { console.warn("[storage] bys_log tone:", err) }
  // Owner Batch 2 (2026-08-11): bys_log.child is the optional child-folder tag
  // (the child's stable id) on a log entry. The Batch-2 handler wrote it to the
  // in-memory row but the schema had no column, so PATCH/POST silently dropped
  // it — the tag never survived a save (QA 4111b5c2). Idempotent; after the
  // parallel CREATE TABLE batch (same race rule as the indexes above).
  try { await sql`ALTER TABLE bys_log ADD COLUMN IF NOT EXISTS child TEXT` } catch (err) { console.warn("[storage] bys_log child:", err) }
  // Two-mode AI Co-Parent (2026-08-11): bys_reviews gains a kind column
  // ('review' | 'analysis') so saved situation analyses open in the analyzer and
  // render the Situation chip in the saved list. Idempotent; after the parallel
  // CREATE TABLE batch (same race rule as the indexes above).
  try { await sql`ALTER TABLE bys_reviews ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'review'` } catch (err) { console.warn("[storage] bys_reviews kind:", err) }
  // Owner Batch 1 (2026-08-11): bys_reviews.title is the optional short name a
  // dad gives a saved review ("pickup agreement draft"), and bys_signups.vid
  // binds a landing-capture row to the browser that typed it (signup-remove
  // guard) so the 90-day abandoned-capture purge stays safe. Both idempotent,
  // after the parallel CREATE TABLE batch (same race rule as the indexes).
  try { await sql`ALTER TABLE bys_reviews ADD COLUMN IF NOT EXISTS title TEXT` } catch (err) { console.warn("[storage] bys_reviews title:", err) }
  try { await sql`ALTER TABLE bys_signups ADD COLUMN IF NOT EXISTS vid TEXT` } catch (err) { console.warn("[storage] signups vid:", err) }
  try { await sql`CREATE INDEX IF NOT EXISTS bys_review_events_user_ts ON bys_review_events(user_id, created_at)` } catch (err) { console.warn("[storage] review_events index:", err) }
  // Calm-loop slice 2: gift-code (giver, created_at) index for the
  // active-unexpired-codes query. Idempotent, after the parallel CREATE TABLE
  // batch (same race rule as the indexes above).
  try { await sql`CREATE INDEX IF NOT EXISTS bys_gift_codes_status_ts ON bys_gift_codes(status, created_at)` } catch (err) { console.warn("[storage] gift_codes index:", err) }
  // Calm-loop fix (L3): session_id TEXT UNIQUE on bys_gift_codes makes the
  // check-then-mint confirm path atomic — a parallel double-confirm for the
  // same Stripe session can never mint two codes (the second INSERT fails the
  // unique constraint and falls back to the first code). Idempotent; after the
  // parallel CREATE TABLE batch (same race rule as the indexes above).
  try { await sql`ALTER TABLE bys_gift_codes ADD COLUMN IF NOT EXISTS session_id TEXT UNIQUE` } catch (err) { console.warn("[storage] gift_codes session_id:", err) }
  // ts-leading + session-time indexes for the owner dashboard's windowed
  // aggregations (hourly/depth/live-visitors queries filter on ts; the session
  // table is scanned on first_ts/last_ts). All idempotent, zero risk.
  try { await sql`CREATE INDEX IF NOT EXISTS bys_events_ts ON bys_events(ts)` } catch (err) { console.warn("[storage] bys_events_ts index:", err) }
  try { await sql`CREATE INDEX IF NOT EXISTS bys_sessions_first_ts ON bys_sessions(first_ts)` } catch (err) { console.warn("[storage] bys_sessions_first_ts index:", err) }
  try { await sql`CREATE INDEX IF NOT EXISTS bys_sessions_last_ts ON bys_sessions(last_ts)` } catch (err) { console.warn("[storage] bys_sessions_last_ts index:", err) }
  // Session-play replay timeline (Metrics 2.0): the /owner per-visitor playback
  // reads by vid ordered by ts; the index must exist for the ORDER BY + LIMIT
  // scan to stay cheap once the table has real volume.
  try { await sql`CREATE INDEX IF NOT EXISTS bys_session_play_vid_ts ON bys_session_play(vid, ts)` } catch (err) { console.warn("[storage] bys_session_play index:", err) }
  try { await sql`CREATE INDEX IF NOT EXISTS bys_tiktok_publishes_publish_id ON bys_tiktok_publishes(publish_id)` } catch (err) { console.warn("[storage] tiktok_publishes index:", err) }
}
function ready(){return boot ||= init().catch(err => { console.warn("[storage] init failed, continuing:", err) })}
async function fs(){ return await import("node:fs/promises") }
async function json(path:string, fallback:any[]=[]){try{return JSON.parse(await (await fs()).readFile(path,"utf8"))}catch{return fallback}}
async function put(path:string,v:any){const f=await fs();await f.mkdir(base,{recursive:true});await f.writeFile(path,JSON.stringify(v,null,2))}
export async function readUsers():Promise<any[]>{await ready();const sql=db();if(sql){const r=await sql`SELECT id,email,password,created_at AS "createdAt",confirmed_at AS "confirmedAt",profile FROM bys_users`;return r as any[]}return json(files.users)}
export async function writeUsers(users:any[]){await ready();const sql=db();if(sql){for(const u of users)await sql`INSERT INTO bys_users(id,email,password,created_at,confirmed_at,profile) VALUES(${u.id},${u.email},${u.password||null},${u.createdAt},${u.confirmedAt||null},${JSON.stringify(u.profile||{})}) ON CONFLICT(id) DO UPDATE SET password=EXCLUDED.password,confirmed_at=EXCLUDED.confirmed_at,profile=EXCLUDED.profile`;return}await put(files.users,users)}
// Merge a small patch into ONE user's profile (single-row UPDATE — cheap, and
// avoids writeUsers' full-list upsert loop). Used by Sort My Pile to remember
// the last completed sort so the compat poll endpoint can return its results.
export async function updateUserProfile(userId:string,patch:any){
  await ready();const sql=db();
  if(sql){await sql`UPDATE bys_users SET profile = profile || CAST(${JSON.stringify(patch||{})} AS jsonb) WHERE id=${userId}`;return}
  const rows=await json(files.users);
  const u=rows.find((x:any)=>x.id===userId);
  if(u){u.profile={...(u.profile||{}),...(patch||{})};await put(files.users,rows);}
}
export async function readReviews(){await ready();const sql=db();if(sql)return await sql`SELECT id,user_id AS "userId",draft,blocks,review,kind,title,created_at AS "createdAt" FROM bys_reviews` as any[];return json(files.reviews)}
// User-scoped review read (M2 audit de2c7f92): WHERE user_id in SQL — the export
// path and Saved tab never need a full-table scan filtered in memory.
export async function readReviewsForUser(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql)return await sql`SELECT id,user_id AS "userId",draft,blocks,review,kind,title,created_at AS "createdAt" FROM bys_reviews WHERE user_id=${userId}` as any[];
  return (await json(files.reviews)).filter((x:any)=>x.userId===userId);
}
export async function writeReviews(rows:any[]){await ready();const sql=db();if(sql){for(const r of rows)await sql`INSERT INTO bys_reviews(id,user_id,draft,blocks,review,kind,title,created_at) VALUES(${r.id},${r.userId},${r.draft},${JSON.stringify(r.blocks||[])},${r.review},${r.kind||"review"},${r.title||null},${r.createdAt}) ON CONFLICT(id) DO UPDATE SET draft=EXCLUDED.draft,blocks=EXCLUDED.blocks,review=EXCLUDED.review,kind=EXCLUDED.kind,title=EXCLUDED.title`;return}await put(files.reviews,rows)}
// P1 delete fix: writeReviews is upsert-only (INSERT ... ON CONFLICT ... DO
// UPDATE per row) — it NEVER issues DELETEs for rows absent from the array,
// so a filter-then-writeReviews delete silently no-oped for every user.
// deleteReview runs a real user-scoped DELETE and reports whether a row was
// actually removed, so the API can 404 (not fake ok) when it wasn't.
export async function deleteReview(userId:string,reviewId:string):Promise<boolean>{
  await ready();const sql=db();
  if(sql){const r=await sql`DELETE FROM bys_reviews WHERE user_id=${userId} AND id=${reviewId} RETURNING id`;return r.length>0}
  const rows=await json(files.reviews);
  const before=rows.length;
  const next=rows.filter((x:any)=>!(x.userId===userId&&x.id===reviewId));
  if(next.length===before)return false;
  await put(files.reviews,next);
  return true;
}
export async function pruneReviews(userId:string, keep=10){await ready();const sql=db();if(sql){await sql`DELETE FROM bys_reviews WHERE user_id=${userId} AND id NOT IN (SELECT id FROM bys_reviews WHERE user_id=${userId} ORDER BY created_at DESC LIMIT ${keep})`;return}const rows=await json(files.reviews);const own=rows.filter((r:any)=>r.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));const ids=new Set(own.slice(keep).map((r:any)=>r.id));await put(files.reviews,rows.filter((r:any)=>!ids.has(r.id)))}
// Permanently remove a user and all of their data (reviews, log, timeline,
// signups, organizer files + trial rows). Used by DELETE /api/account — no
// soft delete, nothing left behind. The organizer tables are lazily created,
// so the organizer DELETEs are individually guarded: a user who never opened
// the Organizer (missing table) must still be able to delete their account.
export async function deleteUserData(userId:string, email:string){
  await ready();const sql=db();
  if(sql){
    await sql`DELETE FROM bys_reviews WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_log WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_timeline WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_signups WHERE email=${email}`;
    await sql`DELETE FROM bys_auth_sessions WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_user_review_usage WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_case_summary WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_action_center WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_review_events WHERE user_id=${userId}`;
    await sql`DELETE FROM bys_gift_codes WHERE giver_id=${userId} OR redeemed_by=${userId}`;
    await sql`DELETE FROM bys_trials WHERE user_id=${userId}`;
    try {
      await sql`DELETE FROM bys_organizer_files WHERE user_id=${userId}`;
      await sql`DELETE FROM bys_organizer_trial_usage WHERE key='user:'||${userId}`;
      await sql`DELETE FROM bys_organizer_usage WHERE user_id=${userId}`;
    } catch (err) { console.warn("[storage] organizer cleanup on delete skipped:", err); }
    await sql`DELETE FROM bys_users WHERE id=${userId}`;
    return;
  }
  const [users,reviews,log,timeline,organizerFiles,organizerTrials,actionCenter,reviewEvents,giftCodes]=await Promise.all([json(files.users),json(files.reviews),json(files.log),json(files.timeline),json(files.organizerFiles),json(files.organizerTrials),json(files.actionCenter),json(files.reviewEvents),json(files.giftCodes)]);
  // L8: the JSON branch must also purge bys-signups.jsonl (email-keyed), the
  // same as the SQL branch's DELETE FROM bys_signups WHERE email. JSONL file —
  // read as text, filter lines whose parsed email matches, rewrite.
  const sf=await fs();
  const signupsRaw=await sf.readFile(files.signups,"utf8").catch(()=>"");
  const signupsKept=(signupsRaw?signupsRaw.split("\n").filter(Boolean):[]).filter((line:string)=>{try{return JSON.parse(line).email!==email}catch{return true}});
  await Promise.all([
    put(files.users,users.filter((u:any)=>u.id!==userId)),
    put(files.reviews,reviews.filter((r:any)=>r.userId!==userId)),
    put(files.log,log.filter((l:any)=>l.userId!==userId)),
    put(files.timeline,timeline.filter((t:any)=>t.userId!==userId)),
    put(files.organizerFiles,organizerFiles.filter((f:any)=>f.userId!==userId)),
    put(files.organizerTrials,organizerTrials.filter((t:any)=>t.key!==`user:${userId}`)),
    put(files.actionCenter,actionCenter.filter((a:any)=>a.userId!==userId)),
    put(files.reviewEvents,reviewEvents.filter((e:any)=>e.userId!==userId)),
    put(files.organizerUsage,(await json(files.organizerUsage)).filter((o:any)=>o.userId!==userId)),
    put(files.giftCodes,giftCodes.filter((g:any)=>g.giverId!==userId&&g.redeemedBy!==userId)),
    put(files.trials,(await json(files.trials)).filter((t:any)=>t.userId!==userId)),
    sf.writeFile(files.signups,signupsKept.length?signupsKept.join("\n")+"\n":""),
  ]);
}
export async function readLog(){await ready();const sql=db();if(sql)return await sql`SELECT id,user_id AS "userId",message,direction,date,topic,notes,tone,child,created_at AS "createdAt",updated_at AS "updatedAt" FROM bys_log` as any[];return json(files.log)}
export async function writeLog(rows:any[]){await ready();const sql=db();if(sql){await sql`DELETE FROM bys_log WHERE NOT (id = ANY(${rows.map(r=>r.id)}))`;for(const r of rows)await sql`INSERT INTO bys_log(id,user_id,message,direction,date,topic,notes,tone,child,created_at,updated_at) VALUES(${r.id},${r.userId},${r.message},${r.direction},${r.date},${r.topic},${r.notes},${r.tone||null},${r.child||null},${r.createdAt},${r.updatedAt||null}) ON CONFLICT(id) DO UPDATE SET message=EXCLUDED.message,direction=EXCLUDED.direction,date=EXCLUDED.date,topic=EXCLUDED.topic,notes=EXCLUDED.notes,tone=EXCLUDED.tone,child=EXCLUDED.child,updated_at=EXCLUDED.updated_at`;return}await put(files.log,rows)}
export async function readTimeline(){await ready();const sql=db();if(sql)return await sql`SELECT id,user_id AS "userId",date,title,category,details,created_at AS "createdAt",updated_at AS "updatedAt" FROM bys_timeline` as any[];return json(files.timeline)}
// User-scoped log/timeline reads (M2 audit de2c7f92): WHERE user_id in SQL —
// the export path never needs a full-table scan filtered in memory.
export async function readLogForUser(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql)return await sql`SELECT id,user_id AS "userId",message,direction,date,topic,notes,tone,child,created_at AS "createdAt",updated_at AS "updatedAt" FROM bys_log WHERE user_id=${userId}` as any[];
  return (await json(files.log)).filter((x:any)=>x.userId===userId);
}
export async function readTimelineForUser(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql)return await sql`SELECT id,user_id AS "userId",date,title,category,details,created_at AS "createdAt",updated_at AS "updatedAt" FROM bys_timeline WHERE user_id=${userId}` as any[];
  return (await json(files.timeline)).filter((x:any)=>x.userId===userId);
}
export async function writeTimeline(rows:any[]){await ready();const sql=db();if(sql){await sql`DELETE FROM bys_timeline WHERE NOT (id = ANY(${rows.map(r=>r.id)}))`;for(const r of rows)await sql`INSERT INTO bys_timeline(id,user_id,date,title,category,details,created_at,updated_at) VALUES(${r.id},${r.userId},${r.date},${r.title},${r.category},${r.details},${r.createdAt},${r.updatedAt||null}) ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,title=EXCLUDED.title,category=EXCLUDED.category,details=EXCLUDED.details,updated_at=EXCLUDED.updated_at`;return}await put(files.timeline,rows)}
export async function addSignup(row:any){await ready();const sql=db();if(sql){await sql`INSERT INTO bys_signups(email,draft,review,vid) VALUES(${row.email},${row.draft||null},${row.review||null},${row.vid||null})`;return}const f=await fs();await f.mkdir(base,{recursive:true});await f.appendFile(files.signups,JSON.stringify(row)+"\n")}
export async function signupReviews(email:string){await ready();const sql=db();if(sql)return await sql`SELECT ts,draft,review FROM bys_signups WHERE email=${email}` as any[];try{return (await (await fs()).readFile(files.signups,"utf8")).trim().split("\n").filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.email===email)}catch{return []}}
// M3 (privacy audit de2c7f92): permanently consume the email-keyed signup rows
// after they have been adopted into a real account's bys_reviews. After this
// runs, nothing addressable by email remains for that address — an attacker who
// later creates a passwordless account under the same email can never read the
// victim's landing-capture drafts. Idempotent by construction (rows are gone).
export async function deleteSignups(email:string):Promise<void>{
  await ready();const sql=db();
  if(sql){await sql`DELETE FROM bys_signups WHERE email=${email}`;return}
  const f=await fs();
  const raw=await f.readFile(files.signups,"utf8").catch(()=>"");
  const kept=(raw?raw.split("\n").filter(Boolean):[]).filter((line:string)=>{try{return JSON.parse(line).email!==email}catch{return true}});
  await f.writeFile(files.signups,kept.length?kept.join("\n")+"\n":"");
}

// Owner Batch 1: abandoned landing-capture rows age out after `days` (default
// 90) — a dad who typed a draft and never finished the signup has it quietly
// forgotten. Parameterized (never raw SQL fragments into neon templates).
export async function purgeOldSignups(days = 90): Promise<void>{
  await ready();const sql=db();
  if(sql){await sql`DELETE FROM bys_signups WHERE ts < now() - make_interval(days => ${days})`;return}
  const f=await fs();
  const raw=await f.readFile(files.signups,"utf8").catch(()=>"");
  const cutoff=Date.now()-days*24*60*60*1000;
  const kept=(raw?raw.split("\n").filter(Boolean):[]).filter((line:string)=>{try{const x=JSON.parse(line);return !x.ts||new Date(x.ts).getTime()>=cutoff}catch{return true}});
  await f.writeFile(files.signups,kept.length?kept.join("\n")+"\n":"");
}
// ---- Entitlement counters ----------------------------------------------------
// Reviews used by a signed-in user in the current calendar month (counted from
// the saved-review rows; the review handler saves via POST /api/reviews).
export async function reviewsThisMonth(userId:string):Promise<number>{
  await ready();const sql=db();
  if(sql){const r=await sql`SELECT count(*)::int AS n FROM bys_reviews WHERE user_id=${userId} AND created_at >= date_trunc('month', now())`;return (r as any[])[0]?.n ?? 0}
  const all=await json(files.reviews);const now=new Date();
  return all.filter((x:any)=>x.userId===userId&&new Date(x.createdAt).getUTCFullYear()===now.getUTCFullYear()&&new Date(x.createdAt).getUTCMonth()===now.getUTCMonth()).length;
}
// Anonymous (not signed in) reviews per calendar day, keyed by client IP. Durable
// in Postgres so the 1/day cap holds across server instances / cold starts.
export async function upsertSessionFromPageView(vid:string, data:{path:string;landingPath?:string;referrer?:string;ua?:string;attribution?:Record<string,string|undefined>}){ await ready(); const sql=db(); const a=data.attribution||{}; const lp=data.landingPath||data.path;
  if(sql){ await sql`INSERT INTO bys_sessions(vid,first_ts,last_ts,referrer,ua,entry_path,exit_path,landing_path,pageviews,source,medium,campaign,gclid,gbraid,wbraid,ttclid) VALUES(${vid},now(),now(),${data.referrer||null},${data.ua||null},${data.path},${data.path},${lp},1,${a.source||null},${a.medium||null},${a.campaign||null},${a.gclid||null},${a.gbraid||null},${a.wbraid||null},${a.ttclid||null}) ON CONFLICT(vid) DO UPDATE SET last_ts=now(),exit_path=EXCLUDED.exit_path,pageviews=bys_sessions.pageviews+1,referrer=COALESCE(bys_sessions.referrer,EXCLUDED.referrer),entry_path=COALESCE(bys_sessions.entry_path,EXCLUDED.entry_path),landing_path=COALESCE(bys_sessions.landing_path,EXCLUDED.landing_path),source=COALESCE(bys_sessions.source,EXCLUDED.source),medium=COALESCE(bys_sessions.medium,EXCLUDED.medium),campaign=COALESCE(bys_sessions.campaign,EXCLUDED.campaign),gclid=COALESCE(bys_sessions.gclid,EXCLUDED.gclid),gbraid=COALESCE(bys_sessions.gbraid,EXCLUDED.gbraid),wbraid=COALESCE(bys_sessions.wbraid,EXCLUDED.wbraid),ttclid=COALESCE(bys_sessions.ttclid,EXCLUDED.ttclid)`; return; }
  const rows=await json(files.sessions); const r=rows.find((x:any)=>x.vid===vid);
  if(r){ r.lastTs=new Date().toISOString(); r.exitPath=data.path; r.pageviews=(r.pageviews||0)+1; if(!r.referrer&&data.referrer)r.referrer=data.referrer; if(!r.entryPath)r.entryPath=data.path; if(!r.landingPath)r.landingPath=lp; for(const k of ["source","medium","campaign","gclid","gbraid","wbraid","ttclid"]){ if(!r[k]&&a[k])r[k]=a[k]; } }
  else rows.push({vid,firstTs:new Date().toISOString(),lastTs:new Date().toISOString(),referrer:data.referrer||"",ua:data.ua||"",entryPath:data.path,exitPath:data.path,landingPath:lp,pageviews:1,source:a.source||"",medium:a.medium||"",campaign:a.campaign||"",gclid:a.gclid||"",gbraid:a.gbraid||"",wbraid:a.wbraid||"",ttclid:a.ttclid||""});
  await put(files.sessions,rows); }
// Conversion-tracking Fix 4 (audit 85fbc48d): the session's stored attribution
// (set first-write-wins from the FIRST page_view) rides onto conversion events
// (account_created / paid) so the funnel can read source/campaign at conversion.
export async function getSessionAttribution(vid:string):Promise<{source?:string;campaign?:string}|null>{ await ready(); const sql=db(); if(sql){ const r=await sql`SELECT source,campaign FROM bys_sessions WHERE vid=${vid}`; return r.length?{source:(r as any[])[0].source||undefined,campaign:(r as any[])[0].campaign||undefined}:null; } const rows=await json(files.sessions); const r=rows.find((x:any)=>x.vid===vid); return r?{source:r.source||undefined,campaign:r.campaign||undefined}:null; }
// Fix 5 dedup guard (audit 85fbc48d): true when a `paid` event already exists
// for this vid in the last 5 minutes — the server confirm write is the single
// source of truth for `paid`, and this ignores any straggler double-fire.
export async function paidEventRecent(vid:string):Promise<boolean>{ await ready(); const sql=db(); if(sql){ const r=await sql`SELECT 1 FROM bys_events WHERE name='paid' AND vid=${vid} AND ts >= now() - interval '5 minutes' LIMIT 1`; return r.length>0; } const rows=await json(files.events); return rows.some((e:any)=>e.name==="paid"&&e.vid===vid&&Date.now()-new Date(e.ts).getTime()<300000); }
export async function addEvent(event:{vid:string;name:string;plan?:string;meta?:any;ts?:string}){ await ready(); const sql=db(); if(sql){ await sql`INSERT INTO bys_events(vid,name,plan,meta,ts) VALUES(${event.vid},${event.name},${event.plan||null},${JSON.stringify(event.meta||{})},${event.ts||new Date().toISOString()})`; return; } const rows=await json(files.events); rows.push({...event,ts:event.ts||new Date().toISOString()}); await put(files.events,rows); }

// ---- Session play (Metrics 2.0) ---------------------------------------------
// Second-by-second replay rows for the owner's per-visitor playback: page
// enter/exit, scroll samples, and every funnel event with client-derived dt/t
// (ms since previous row / ms since session start). Kept in its own table so
// replay noise (scroll samples, enters/exits) NEVER pollutes the funnel,
// hourly, depth, or live panels — those read bys_events only.
const SESSION_PLAY_CAP = 1200; // prune trigger; keep newest 1000 per vid
export async function addSessionPlay(row:{vid:string;kind?:string;name?:string;dt?:number;t?:number;depthPct?:number;path?:string;meta?:any;ts?:string}){
  await ready(); const sql=db();
  if(sql){
    await sql`INSERT INTO bys_session_play(vid,kind,name,dt,t,depth_pct,path,meta,ts) VALUES(${row.vid},${row.kind||"event"},${row.name||null},${row.dt ?? null},${row.t ?? null},${row.depthPct ?? null},${row.path||null},${JSON.stringify(row.meta||{})},${row.ts||new Date().toISOString()})`;
    // Opportunistic per-vid cap: scroll beacons are unbounded; only prune once
    // the vid exceeds the cap so a pathological session can't balloon the table
    // while normal inserts stay one round-trip.
    try {
      const r=await sql`SELECT count(*)::int AS n FROM bys_session_play WHERE vid=${row.vid}`;
      if((r as any[])[0]?.n > SESSION_PLAY_CAP){
        await sql`DELETE FROM bys_session_play WHERE vid=${row.vid} AND id NOT IN (SELECT id FROM bys_session_play WHERE vid=${row.vid} ORDER BY id DESC LIMIT 1000)`;
      }
    } catch (err) { console.warn("[storage] session-play prune:", err) }
    return;
  }
  const rows=await json(files.sessionPlay);
  rows.push({...row,ts:row.ts||new Date().toISOString()});
  await put(files.sessionPlay,rows.slice(-1000));
}
// Ordered replay timeline for one vid: the most recent `limit` rows (default
// 200), oldest first. sinceMs narrows the window (optional). Rows with no
// client t/dt fall back to wall-clock ts on read — the UI shows the honest
// minimal state rather than fabricating a duration.
export async function sessionPlayForVisitor(vid:string, sinceMs?:number, limit=200):Promise<any[]>{
  await ready(); const sql=db();
  if(sql){
    const since = sinceMs ? new Date(sinceMs).toISOString() : undefined;
    // Window FIRST by server receive order (the panel shows the latest `limit`
    // rows of activity), then order THAT window by the client clock (t ASC,
    // NULLS LAST) with ts + id as the tiebreak. Mobile beacons can batch and
    // arrive out of server order (esp. at pagehide), so ordering the display by
    // client t keeps dt chaining and the [+m:ss] clock honest. Rows without t
    // (pre-t legacy rows) sort last inside the window. The old .reverse() is
    // gone: the outer ORDER BY already returns the window oldest-first, and the
    // UI's oldest→newest array contract + "▲ New visit" (t < prevT) logic in
    // owner.tsx buildPlaySegments are unchanged.
    const r = since
      ? await sql`SELECT kind,name,dt,t,depth_pct AS "depthPct",path,ts,meta FROM (SELECT kind,name,dt,t,depth_pct,path,ts,meta,id FROM bys_session_play WHERE vid=${vid} AND ts >= ${since} ORDER BY ts DESC, id DESC LIMIT ${limit}) recent ORDER BY t ASC NULLS LAST, ts ASC, id ASC`
      : await sql`SELECT kind,name,dt,t,depth_pct AS "depthPct",path,ts,meta FROM (SELECT kind,name,dt,t,depth_pct,path,ts,meta,id FROM bys_session_play WHERE vid=${vid} ORDER BY ts DESC, id DESC LIMIT ${limit}) recent ORDER BY t ASC NULLS LAST, ts ASC, id ASC`;
    return (r as any[]).map((e:any)=>({ kind:e.kind, name:e.name||undefined, dt:e.dt!=null?Number(e.dt):undefined, t:e.t!=null?Number(e.t):undefined, depthPct:e.depthPct!=null?Number(e.depthPct):undefined, path:e.path||undefined, ts:e.ts, meta:metaObj(e.meta) }));
  }
  const rows=await json(files.sessionPlay);
  return rows.filter((x:any)=>x.vid===vid && (!sinceMs || new Date(x.ts).getTime()>=sinceMs)).slice(-limit)
    .sort((a:any,b:any)=>{ const at=typeof a.t==="number"?a.t:Infinity, bt=typeof b.t==="number"?b.t:Infinity; if(at!==bt)return at-bt; const ats=new Date(a.ts).getTime(), bts=new Date(b.ts).getTime(); if(ats!==bts)return ats-bts; return (a.id??0)-(b.id??0); })
    .map((e:any)=>({ kind:e.kind||"event", name:e.name||undefined, dt:e.dt!=null?Number(e.dt):undefined, t:e.t!=null?Number(e.t):undefined, depthPct:e.depthPct!=null?Number(e.depthPct):undefined, path:e.path||undefined, ts:e.ts, meta:metaObj(e.meta) }));
}
// ---- Owner dashboard metrics ------------------------------------------------
// Data-quality filter: our own curl/agent-browser/bot testing pollutes session
// counts (today showed ~1500 sessions vs ~127 real page views). Anything whose
// user-agent looks automated is excluded from "unique visitors" and "sessions
// today"; the raw totals are still reported so the owner sees data health.
const BOT_UA_RE = /(curl|python|agent-browser|bot|spider|HeadlessChrome|Googlebot)/i;
function isBotUa(ua?: string | null): boolean { return !!ua && BOT_UA_RE.test(ua); }
// Cheap, honest UA classification for the owner dashboard's device panels.
// Order matters: iPad|Tablet first (iPadOS UAs carry "Mobile" too, so the
// /Mobi/ test alone would mislabel every iPad as a phone).
function deviceClass(ua?: string | null): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi/i.test(ua)) return "mobile";
  return "desktop";
}
function osName(ua?: string | null): string {
  const s = ua || "";
  if (/iPhone|iPad|iPod/i.test(s)) return "iOS";
  if (/Android/i.test(s)) return "Android";
  if (/Windows/i.test(s)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(s)) return "macOS";
  if (/Linux/i.test(s)) return "Linux";
  return "Other";
}
function hostOf(referrer: string): string {
  try { return new URL(referrer).hostname; } catch { return referrer.split("/")[0] || referrer; }
}
// Traffic source from the landing URL's paid-query params first, then referrer.
export function sourceLabel(referrer: string | null | undefined, landingPath?: string | null): string {
  const land = (landingPath || "").toLowerCase();
  if (land.includes("ttclid")) return "TikTok";
  if (land.includes("gclid")) return "Google";
  const ref = (referrer || "").trim().toLowerCase();
  if (!ref) return "Direct / internal";
  const host = hostOf(ref);
  if (host.includes("tiktok.com")) return "TikTok";
  if (/^google\./.test(host) || host === "google.com" || host.includes("google.")) return "Google";
  if (host.includes("beforeyousend.org")) return "Direct / internal";
  return "Other";
}
// Display labels for the stored session-attribution columns (lowercase in the
// DB per Fix 4: source='google'/'tiktok'/'direct'/'other'); the /owner chips stay
// human ("Google" / "TikTok" / "Direct / internal").
const SOURCE_DISPLAY: Record<string, string> = { google: "Google", tiktok: "TikTok", direct: "Direct / internal", other: "Other", referral: "Referral" };
function sourceDisplay(s?: string | null): string { if (s && SOURCE_DISPLAY[s]) return SOURCE_DISPLAY[s]; return s || ""; }
function metaObj(m: any): any {
  if (m == null) return {};
  if (typeof m === "string") { try { return JSON.parse(m); } catch { return {}; } }
  return m;
}
function stripQuery(p: string): string { return p.split("?")[0]; }

export async function metricsSummary(): Promise<any> {
  // Two views power the /owner board (owner 2026-08-13): LIVE NOW (who is on
  // the site right now — sessions active in the last 15 minutes, with current
  // page, on-site time, idle, source, device) and SESSIONS (per-visitor trails
  // over the last 24 hours — each page they visited and how long they stayed,
  // with a link into the second-by-second session-play replay). A compact
  // funnel (events today) rides along for the ads. Everything here is a raw
  // table count; nothing is fabricated. Bot UAs are excluded from visitor
  // counts; the operator's own /owner + /api traffic is hidden from the boards
  // (it is the owner checking the dashboard, not a site visitor).
  await ready(); const sql = db();
  if (sql) {
    const [funnelRows, sessTodayRows, liveSessRows, trailSessRows] = await Promise.all([
      sql`SELECT name, count(*)::int AS count FROM bys_events WHERE ts >= date_trunc('day', now()) GROUP BY name`,
      sql`SELECT vid, ua FROM bys_sessions WHERE first_ts >= date_trunc('day', now())`,
      sql`SELECT vid, first_ts, last_ts, referrer, ua, entry_path, landing_path, pageviews, source, medium, campaign, gclid, gbraid, wbraid, ttclid FROM bys_sessions WHERE last_ts >= now() - interval '15 minutes' ORDER BY last_ts DESC`,
      sql`SELECT vid, first_ts, last_ts, referrer, ua, entry_path, landing_path, pageviews, source, medium, campaign, gclid, gbraid, wbraid, ttclid FROM bys_sessions WHERE last_ts >= now() - interval '24 hours' ORDER BY last_ts DESC LIMIT 80`,
    ]);
    const liveSess = (liveSessRows as any[]).filter((s: any) => !isBotUa(s.ua));
    const trailSess = (trailSessRows as any[]).filter((s: any) => !isBotUa(s.ua));
    // Events for the live sessions (30-min window, newest first): the latest
    // event per vid + the latest page_view path (the page they're on now).
    const liveVids = [...new Set(liveSess.map((s: any) => s.vid))];
    let liveEvRows: any[] = [];
    if (liveVids.length) liveEvRows = (await sql`SELECT vid, name, ts, meta FROM bys_events WHERE vid = ANY(${liveVids}) AND ts >= now() - interval '30 minutes' ORDER BY ts DESC LIMIT 600`) as any[];
    // Page-view trails for the trail sessions (last 24h).
    const trailVids = [...new Set(trailSess.map((s: any) => s.vid))];
    let pvRows: any[] = [];
    if (trailVids.length) pvRows = (await sql`SELECT vid, ts, meta FROM bys_events WHERE name = 'page_view' AND vid = ANY(${trailVids}) AND ts >= now() - interval '24 hours'`) as any[];
    const isOperatorPath = (p: string) => p.startsWith("/owner") || p.startsWith("/api/");
    // ---- LIVE NOW -------------------------------------------------------------
    const liveEv: Record<string, any[]> = {};
    for (const e of liveEvRows) { (liveEv[e.vid] = liveEv[e.vid] || []).push(e); }
    const liveNow = liveSess
      .map((s: any) => {
        const evs = liveEv[s.vid] || [];
        let curPath: string | undefined;
        let lastEvent = "session";
        let lastMs = new Date(s.last_ts).getTime();
        for (const e of evs) { // newest first
          // Only page_view events carry the page the visitor is ON — other
          // events (review_started etc.) keep meta.path too, and taking the
          // newest event's path would mislabel the current page.
          if (curPath === undefined && e.name === "page_view") { const m = metaObj(e.meta); const p = typeof m.path === "string" ? stripQuery(m.path) : undefined; if (p) curPath = p; }
          lastEvent = e.name;
          const tsMs = new Date(e.ts).getTime();
          if (tsMs > lastMs) lastMs = tsMs;
        }
        if (!curPath || isOperatorPath(curPath)) return null;
        return {
          vid: s.vid.slice(0, 8), vidFull: s.vid,
          path: curPath,
          entryPath: stripQuery(s.landing_path || s.entry_path || ""),
          firstMs: new Date(s.first_ts).getTime(),
          lastMs,
          source: sourceDisplay(s.source) || sourceLabel(s.referrer, s.landing_path),
          device: deviceClass(s.ua), os: osName(s.ua),
          lastEvent,
        };
      })
      .filter((x: any) => !!x)
      .sort((a: any, b: any) => b.lastMs - a.lastMs);
    // ---- SESSIONS (where people go & how long, last 24h) ----------------------
    const pvByVid: Record<string, any[]> = {};
    for (const r of pvRows) { (pvByVid[r.vid] = pvByVid[r.vid] || []).push(r); }
    const sessions = trailSess
      .map((s: any) => {
        const pvs = (pvByVid[s.vid] || [])
          .map((p: any) => ({ path: stripQuery(typeof metaObj(p.meta).path === "string" ? metaObj(p.meta).path : ""), ts: new Date(p.ts).getTime() }))
          .filter((p: any) => !!p.path && !isOperatorPath(p.path))
          .sort((a: any, b: any) => a.ts - b.ts);
        if (!pvs.length) return null;
        const firstMs = new Date(s.first_ts).getTime();
        const lastMs = new Date(s.last_ts).getTime();
        const steps = pvs.map((p: any, i: number) => {
          const next = i + 1 < pvs.length ? pvs[i + 1].ts : undefined;
          return { path: p.path, durMs: Math.max(0, next ? next - p.ts : lastMs - p.ts), ts: p.ts };
        });
        return {
          vid: s.vid.slice(0, 8), vidFull: s.vid,
          firstMs, lastMs, durationMs: Math.max(0, lastMs - firstMs),
          pages: pvs.length,
          source: sourceDisplay(s.source) || sourceLabel(s.referrer, s.landing_path),
          device: deviceClass(s.ua), os: osName(s.ua),
          steps,
        };
      })
      .filter((x: any) => !!x)
      .sort((a: any, b: any) => b.lastMs - a.lastMs)
      .slice(0, 50);
    // ---- Funnel + today counts -------------------------------------------------
    const counts: any = {}; (funnelRows as any[]).forEach((f: any) => { counts[f.name] = Number(f.count); });
    const funnel = Object.entries(counts).map(([name, count]) => ({ name, count }));
    const eventsToday = (funnelRows as any[]).reduce((sum: number, f: any) => sum + Number(f.count), 0);
    const sessToday = sessTodayRows as any[];
    const realToday = sessToday.filter((s: any) => !isBotUa(s.ua));
    const sessionsToday = realToday.length;
    const uniqueVisitorsToday = new Set(realToday.map((s: any) => s.vid)).size;
    const dataHealth = {
      eventsToday,
      sessionsToday,
      eventsPerSession: sessionsToday ? Math.round((eventsToday / sessionsToday) * 10) / 10 : 0,
      sessionsRawToday: sessToday.length,
      botsFiltered: sessToday.length - sessionsToday,
    };
    return { funnel, sessionsToday, uniqueVisitorsToday, eventsToday, dataHealth, liveNow, sessions };
  }
  // JSON fallback (no DATABASE_URL — dev only): same shape, minimal data.
  const rows = await json(files.events);
  const counts: any = {}; rows.forEach((x: any) => { counts[x.name] = (counts[x.name] || 0) + 1; });
  const funnel = Object.entries(counts).map(([name, count]) => ({ name, count }));
  const sessions = await json(files.sessions);
  const real = sessions.filter((x: any) => !isBotUa(x.ua));
  const now = Date.now();
  const liveNow = real
    .filter((s: any) => now - new Date(s.lastTs || s.last_ts || s.firstTs || s.first_ts).getTime() < 15 * 60000)
    .map((s: any) => ({
      vid: String(s.vid || "").slice(0, 8), vidFull: String(s.vid || ""),
      path: String(s.landingPath || s.entryPath || "/").split("?")[0],
      entryPath: String(s.landingPath || s.entryPath || "").split("?")[0],
      firstMs: new Date(s.firstTs || s.first_ts).getTime(),
      lastMs: new Date(s.lastTs || s.last_ts || s.firstTs || s.first_ts).getTime(),
      source: sourceDisplay(s.source) || sourceLabel(s.referrer, s.landingPath),
      device: deviceClass(s.ua), os: osName(s.ua),
      lastEvent: "session",
    }))
    .filter((x: any) => x.path && !x.path.startsWith("/owner") && !x.path.startsWith("/api/"));
  return {
    funnel,
    sessionsToday: real.length,
    uniqueVisitorsToday: new Set(real.map((x: any) => x.vid)).size,
    eventsToday: rows.length,
    dataHealth: { eventsToday: rows.length, sessionsToday: real.length, eventsPerSession: real.length ? Math.round((rows.length / real.length) * 10) / 10 : 0, sessionsRawToday: sessions.length, botsFiltered: sessions.length - real.length },
    liveNow,
    sessions: [],
  };
}

// ---- Owner reset ------------------------------------------------------------
// Clears ALL rows in the analytics tables (events, sessions, session play, and
// the anonymous-review usage counters) so the owner can start the board clean
// anytime. NEVER touches bys_users / bys_auth_sessions / bys_reviews / any
// money table. Returns how many rows were removed per table.
export async function clearMetrics(): Promise<{ events: number; sessions: number; session_play: number; anon_usage: number; anon_usage_vid: number }> {
  await ready(); const sql = db();
  if (sql) {
    const [e, s, p, a, av] = await Promise.all([
      sql`DELETE FROM bys_events`,
      sql`DELETE FROM bys_sessions`,
      sql`DELETE FROM bys_session_play`,
      sql`DELETE FROM bys_anon_usage`,
      sql`DELETE FROM bys_anon_usage_vid`,
    ]);
    const cnt = (r: any) => { const row = (r as any[])[0]; return typeof row?.rowCount === "number" ? row.rowCount : 0; };
    return { events: cnt(e), sessions: cnt(s), session_play: cnt(p), anon_usage: cnt(a), anon_usage_vid: cnt(av) };
  }
  const ev = await json(files.events); await put(files.events, []);
  const se = await json(files.sessions); await put(files.sessions, []);
  const sp = await json(files.sessionPlay); await put(files.sessionPlay, []);
  const an = await json(files.anon); await put(files.anon, []);
  return { events: ev.length, sessions: se.length, session_play: sp.length, anon_usage: an.length, anon_usage_vid: 0 };
}

// ---- Per-visitor timeline (owner drill-down) ---------------------------------
// Last `limit` events for one vid, oldest first (chronological for the UI).
export async function eventsForVid(vid: string, limit = 50): Promise<any[]> {
  await ready(); const sql = db();
  if (sql) {
    const r = await sql`SELECT name, ts, plan, meta FROM bys_events WHERE vid = ${vid} ORDER BY ts DESC LIMIT ${limit}`;
    return (r as any[]).map((e: any) => {
      const meta = metaObj(e.meta);
      return { name: e.name, plan: e.plan || undefined, ts: e.ts, ms: new Date(e.ts).getTime(), path: typeof meta.path === "string" ? stripQuery(meta.path) : undefined };
    }).reverse();
  }
  const rows = await json(files.events);
  return rows.filter((x: any) => x.vid === vid).sort((a: any, b: any) => String(a.ts).localeCompare(String(b.ts))).slice(-limit).map((e: any) => ({ name: e.name, plan: e.plan, ts: e.ts, ms: new Date(e.ts).getTime(), path: e.meta?.path ? stripQuery(String(e.meta.path)) : undefined }));
}

// ---- Durable auth sessions ---------------------------------------------------
// Signed-in sessions persist in Postgres so logins survive serverless cold starts
// and deploys (the in-memory Map in server-api.ts is just a fast cache on top).
// exp is an epoch-ms BIGINT so it compares directly against Date.now().
export async function upsertAuthSession(token: string, userId: string, expMs: number) {
  await ready(); const sql = db();
  if (sql) { await sql`INSERT INTO bys_auth_sessions (token, user_id, exp) VALUES (${token}, ${userId}, ${expMs}) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, exp = EXCLUDED.exp`; return; }
  const rows = await json(files.authSessions);
  const i = rows.findIndex((x: any) => x.token === token);
  if (i >= 0) rows[i] = { token, userId, exp: expMs }; else rows.push({ token, userId, exp: expMs });
  await put(files.authSessions, rows);
}
export async function getAuthSession(token: string): Promise<{ token: string; userId: string; exp: number } | null> {
  await ready(); const sql = db();
  if (sql) { const r = await sql`SELECT token, user_id AS "userId", exp FROM bys_auth_sessions WHERE token = ${token}`; const row = (r as any[])[0]; if (!row) return null; return { token: row.token, userId: row.userId, exp: Number(row.exp) }; }
  const rows = await json(files.authSessions);
  const row = rows.find((x: any) => x.token === token);
  return row ? { token: row.token, userId: row.userId, exp: Number(row.exp) } : null;
}
export async function deleteAuthSession(token: string) {
  await ready(); const sql = db();
  if (sql) { await sql`DELETE FROM bys_auth_sessions WHERE token = ${token}`; return; }
  const rows = await json(files.authSessions);
  await put(files.authSessions, rows.filter((x: any) => x.token !== token));
}
// Opportunistic purge of expired rows (called on session warm-up misses).
export async function purgeExpiredAuthSessions() {
  await ready(); const sql = db();
  if (sql) { await sql`DELETE FROM bys_auth_sessions WHERE exp < ${Date.now()}`; return; }
  const rows = await json(files.authSessions);
  const now = Date.now();
  await put(files.authSessions, rows.filter((x: any) => Number(x.exp) >= now));
}

// ---- Durable confirm tokens --------------------------------------------------
// The /confirm link token issued by POST /api/save (and the /api/auth/confirm-link
// resend) lives in Postgres instead of a serverless-instance-local Map, so a user
// who clicks the link onto a different instance never sees "invalid or expired".
// Same shape as bys_auth_sessions: exp is an epoch-ms BIGINT.
// purpose: 'signup' (in-app confirm, may be returned in the response when email
//   is unconfigured) vs 'signin' (only minted when the email actually sent —
//   never returned in-app). delivered: did the link actually leave the server
//   via a real email send. vid: the bys_vid cookie of the minting browser —
//   /api/auth/confirm requires a matching request vid (stolen-link guard).
export async function upsertConfirmToken(token: string, email: string, expMs: number, purpose = "signup", delivered = false, vid: string | null = null) {
  await ready(); const sql = db();
  if (sql) { await sql`INSERT INTO bys_confirm_tokens (token, email, exp, purpose, delivered, vid) VALUES (${token}, ${email}, ${expMs}, ${purpose}, ${delivered}, ${vid}) ON CONFLICT (token) DO UPDATE SET email = EXCLUDED.email, exp = EXCLUDED.exp, purpose = EXCLUDED.purpose, delivered = EXCLUDED.delivered, vid = EXCLUDED.vid`; return; }
  const rows = await json(files.confirmTokens);
  const i = rows.findIndex((x: any) => x.token === token);
  if (i >= 0) rows[i] = { token, email, exp: expMs, purpose, delivered, vid }; else rows.push({ token, email, exp: expMs, purpose, delivered, vid });
  await put(files.confirmTokens, rows);
}
export async function getConfirmToken(token: string): Promise<{ token: string; email: string; exp: number; purpose: string; delivered: boolean; vid: string | null } | null> {
  await ready(); const sql = db();
  if (sql) { const r = await sql`SELECT token, email, exp, purpose, delivered, vid FROM bys_confirm_tokens WHERE token = ${token}`; const row = (r as any[])[0]; if (!row) return null; return { token: row.token, email: row.email, exp: Number(row.exp), purpose: row.purpose || "signup", delivered: !!row.delivered, vid: row.vid || null }; }
  const rows = await json(files.confirmTokens);
  const row = rows.find((x: any) => x.token === token);
  return row ? { token: row.token, email: row.email, exp: Number(row.exp), purpose: row.purpose || "signup", delivered: !!row.delivered, vid: row.vid || null } : null;
}
export async function deleteConfirmToken(token: string) {
  await ready(); const sql = db();
  if (sql) { await sql`DELETE FROM bys_confirm_tokens WHERE token = ${token}`; return; }
  const rows = await json(files.confirmTokens);
  await put(files.confirmTokens, rows.filter((x: any) => x.token !== token));
}
// Opportunistic purge of expired rows (called when a token lookup misses).
export async function purgeExpiredConfirmTokens() {
  await ready(); const sql = db();
  if (sql) { await sql`DELETE FROM bys_confirm_tokens WHERE exp < ${Date.now()}`; return; }
  const rows = await json(files.confirmTokens);
  const now = Date.now();
  await put(files.confirmTokens, rows.filter((x: any) => Number(x.exp) >= now));
}

// ---- H3b: confirm-link / save rate limiting. Durable in Neon so serverless
// instances share one counter; in-memory Map fallback when no DB. Each call
// increments the key's window and returns true once it's over `max`.
const confirmRateCache = new Map<string, { windowStart: number; count: number }>();
export async function confirmRateHit(key: string, max: number, windowMs: number): Promise<boolean> {
  await ready();
  const now = Date.now();
  const sql = db();
  if (sql) {
    try {
      await sql`CREATE TABLE IF NOT EXISTS bys_confirm_rate (key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INT NOT NULL DEFAULT 1)`;
      const rows = await sql`SELECT window_start, count FROM bys_confirm_rate WHERE key = ${key}`;
      const row = (rows as any[])[0];
      if (!row || Number(row.window_start) < now - windowMs) {
        await sql`INSERT INTO bys_confirm_rate (key, window_start, count) VALUES (${key}, ${now}, 1) ON CONFLICT (key) DO UPDATE SET window_start = EXCLUDED.window_start, count = 1`;
        return false;
      }
      const c = Number(row.count) + 1;
      await sql`UPDATE bys_confirm_rate SET count = ${c} WHERE key = ${key}`;
      return c > max;
    } catch (err) {
      console.warn("[rate] DB counter failed, falling back to in-memory:", err);
    }
  }
  const hit = confirmRateCache.get(key);
  if (!hit || hit.windowStart < now - windowMs) {
    confirmRateCache.set(key, { windowStart: now, count: 1 });
    return false;
  }
  hit.count += 1;
  return hit.count > max;
}

export async function incrementAnonReview(ip:string):Promise<number>{   await ready();const day=new Date().toISOString().slice(0,10);const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_anon_usage (ip TEXT NOT NULL, day TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (ip, day))`;
    const r=await sql`INSERT INTO bys_anon_usage (ip, day, count) VALUES (${ip}, ${day}, 1) ON CONFLICT (ip, day) DO UPDATE SET count = bys_anon_usage.count + 1 RETURNING count`;
    return (r as any[])[0]?.count ?? 1;
  }
  const rows=await json(files.anon);const key=`${ip}|${day}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec){rec.count+=1}else{rows.push({key,ip,day,count:1})}
  await put(files.anon,rows);return rec?rec.count:1;
}
// Anonymous free-review quota keyed by visitor id (bys_vid cookie): 1/day per
// vid. Mirrors incrementAnonReview exactly but with its own table — the two
// counters have different key spaces and thresholds (vid=1/day, ip=N/day), and
// the IP table stays untouched as the abuse cap. JSON fallback shares
// bys-anon.json with a "vid:" key prefix so the two counters never collide.
export async function incrementAnonReviewVid(vid:string):Promise<number>{   await ready();const day=new Date().toISOString().slice(0,10);const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_anon_usage_vid (vid TEXT NOT NULL, day TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (vid, day))`;
    const r=await sql`INSERT INTO bys_anon_usage_vid (vid, day, count) VALUES (${vid}, ${day}, 1) ON CONFLICT (vid, day) DO UPDATE SET count = bys_anon_usage_vid.count + 1 RETURNING count`;
    return (r as any[])[0]?.count ?? 1;
  }
  const rows=await json(files.anon);const key=`vid:${vid}|${day}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec){rec.count+=1}else{rows.push({key,vid,day,count:1})}
  await put(files.anon,rows);return rec?rec.count:1;
}
// READ-ONLY anonymous free-review gate check (polish r1, QA 99d7894e). The
// vid counter is now LAZY: incremented only after a genuinely successful
// stream, never at request start — so a failed/killed review can never consume
// the free slot (the old increment-then-refund design left the counter stuck
// at 1 for the UTC day when the serverless function died mid-stream and the
// fire-and-forget refund never ran → "Try again" hit 402). Mirrors
// userReviewUsage: SELECT only, no write.
export async function anonReviewVidUsed(vid: string): Promise<number> {
  await ready(); const day = new Date().toISOString().slice(0, 10); const sql = db();
  if (sql) {
    // Self-healing for fresh environments (review 873604d6 A1): the increment
    // path creates this table inline; a bare SELECT here would throw on a DB
    // where the table doesn't exist yet, 500ing every anon review forever.
    await sql`CREATE TABLE IF NOT EXISTS bys_anon_usage_vid (vid TEXT NOT NULL, day TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (vid, day))`;
    const r = await sql`SELECT count AS n FROM bys_anon_usage_vid WHERE vid=${vid} AND day=${day}`;
    return (r as any[])[0]?.n ?? 0;
  }
  const rows = await json(files.anon); const key = `vid:${vid}|${day}`; const rec = rows.find((x: any) => x.key === key);
  return rec ? Number(rec.count) || 0 : 0;
}
// Refund an anonymous daily review slot after a FAILED generation. The anon
// counters increment BEFORE the LLM fetch (they must, to be atomic against
// concurrent requests), so a provider blip that kills the stream would
// otherwise burn a dad's "first review always free". GREATEST(count-1,0) keeps
// the counter at 0, never negative — a refund can never open a quota hole.
export async function refundAnonReview(ip:string):Promise<void>{
  await ready();const day=new Date().toISOString().slice(0,10);const sql=db();
  if(sql){await sql`UPDATE bys_anon_usage SET count = GREATEST(count - 1, 0) WHERE ip = ${ip} AND day = ${day}`;return}
  const rows=await json(files.anon);const key=`${ip}|${day}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec&&rec.count>0)rec.count-=1;
  await put(files.anon,rows);
}
// ---- Signed-in monthly stream counter (M2 fix) -------------------------------
// The monthly quota gate for signed-in free/steady users used to count SAVED
// review rows (bys_reviews is written only on save) — so a user could stream
// unlimited reviews without saving. This counter counts STREAMS per user per
// UTC calendar month, checked+incremented at the review gate and refunded on a
// failed/aborted stream (same GREATEST(count-1,0) semantics as the anon
// counters — a refund can never open a quota hole). Keyed (user_id, month);
// JSON fallback shares bys-anon.json with a "usr:" key prefix so it never
// collides with the ip/vid day counters. Inline DDL like incrementAnonReviewVid
// — init() untouched.
function monthKey(){return new Date().toISOString().slice(0,7)}
export async function userReviewUsage(userId:string):Promise<number>{
  await ready();const sql=db();
  if(sql){const r=await sql`SELECT count AS n FROM bys_user_review_usage WHERE user_id=${userId} AND month=${monthKey()}`;return (r as any[])[0]?.n ?? 0}
  const rows=await json(files.anon);const key=`usr:${userId}|${monthKey()}`;const rec=rows.find((x:any)=>x.key===key);
  return rec?Number(rec.count)||0:0;
}
export async function incrementUserReview(userId:string):Promise<number>{
  await ready();const month=monthKey();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_user_review_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))`;
    const r=await sql`INSERT INTO bys_user_review_usage (user_id, month, count) VALUES (${userId}, ${month}, 1) ON CONFLICT (user_id, month) DO UPDATE SET count = bys_user_review_usage.count + 1 RETURNING count`;
    return (r as any[])[0]?.count ?? 1;
  }
  const rows=await json(files.anon);const key=`usr:${userId}|${month}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec){rec.count=(Number(rec.count)||0)+1;rec.userId=userId;rec.month=month}else{rows.push({key,userId,month,count:1})}
  await put(files.anon,rows);return rec?rec.count:1;
}
export async function refundUserReview(userId:string):Promise<void>{
  await ready();const month=monthKey();const sql=db();
  if(sql){await sql`UPDATE bys_user_review_usage SET count = GREATEST(count - 1, 0) WHERE user_id=${userId} AND month=${month}`;return}
  const rows=await json(files.anon);const key=`usr:${userId}|${month}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec&&Number(rec.count)>0)rec.count-=1;
  await put(files.anon,rows);
}

// ---- The Organizer demo trial (5 free trials per visitor EVER — account-keyed
// when signed in, vid-keyed when anonymous; 1→5 count migration 2026-08-12,
// preflight 766ccd02). Inline DDL in the helpers (copy incrementAnonReviewVid
// pattern — init() untouched); JSON fallback uses bys-organizer-trials.json.
export async function organizerTrialCount(key:string):Promise<number>{
  await ready();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_trial_usage (key TEXT PRIMARY KEY, used_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE bys_organizer_trial_usage ADD COLUMN IF NOT EXISTS count INT NOT NULL DEFAULT 1`;
    const r=await sql`SELECT count FROM bys_organizer_trial_usage WHERE key=${key}`;
    return Number((r as any[])[0]?.count) || 0;
  }
  const rows=await json(files.organizerTrials);
  const rec=rows.find((x:any)=>x.key===key);
  return rec ? Number(rec.count) || 1 : 0;
}
export async function markOrganizerTrial(key:string):Promise<number>{
  await ready();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_trial_usage (key TEXT PRIMARY KEY, used_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE bys_organizer_trial_usage ADD COLUMN IF NOT EXISTS count INT NOT NULL DEFAULT 1`;
    const r=await sql`INSERT INTO bys_organizer_trial_usage (key, count) VALUES (${key}, 1) ON CONFLICT (key) DO UPDATE SET count = bys_organizer_trial_usage.count + 1 RETURNING count`;
    pruneOrganizerTrialUsage(60).catch((err) => console.warn("[storage] organizer trial prune failed:", err));
    return Number((r as any[])[0]?.count) || 1;
  }
  const rows=await json(files.organizerTrials);
  const rec=rows.find((x:any)=>x.key===key);
  if(rec){rec.count=(Number(rec.count)||1)+1;rec.usedAt=new Date().toISOString()}else{rows.push({key,usedAt:new Date().toISOString(),count:1})}
  await put(files.organizerTrials,rows);
  return rec ? Number(rec.count) : 1;
}
// IP-wide abuse cap for the ANONYMOUS organizer trial (cookie-less clients get
// a fresh server-minted vid each request, so the vid key can't bind — a bot
// could burn unlimited paid LLM calls). Mirrors incrementAnonReview exactly
// but with its own table; JSON fallback shares bys-anon.json with an "org:"
// key prefix so the ip/vid day counters never collide. Signed-in trials are
// keyed by account and never touch this counter.
export async function incrementOrganizerTrialIp(ip:string):Promise<number>{
  await ready();const day=new Date().toISOString().slice(0,10);const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_trial_ip (ip TEXT NOT NULL, day TEXT NOT NULL, count INT NOT NULL DEFAULT 0, PRIMARY KEY (ip, day))`;
    const r=await sql`INSERT INTO bys_organizer_trial_ip (ip, day, count) VALUES (${ip}, ${day}, 1) ON CONFLICT (ip, day) DO UPDATE SET count = bys_organizer_trial_ip.count + 1 RETURNING count`;
    return (r as any[])[0]?.count ?? 1;
  }
  const rows=await json(files.anon);const key=`org:${ip}|${day}`;const rec=rows.find((x:any)=>x.key===key);
  if(rec){rec.count+=1}else{rows.push({key,ip,day,count:1})}
  await put(files.anon,rows);return rec?rec.count:1;
}
// Prune stale anonymous trial rows (an unbounded vid per request means rows can
// grow without a prune). Called from markOrganizerTrial — a natural, low-rate
// point; guarded so a prune failure never breaks the trial itself.
export async function pruneOrganizerTrialUsage(days:number):Promise<void>{
  await ready();const sql=db();
  if(sql){
    await sql`DELETE FROM bys_organizer_trial_usage WHERE used_at < now() - make_interval(days => ${days})`;
    return;
  }
  const rows=await json(files.organizerTrials);
  const cutoff=Date.now()-days*86400000;
  await put(files.organizerTrials,rows.filter((x:any)=>!x.usedAt||new Date(x.usedAt).getTime()>=cutoff));
}

// ---- Organizer files (Command Center paid feature; endpoints ship this cycle,
// UI next cycle). Same CRUD shape as bys_log: full own-row read, upsert, delete.
// Row mapper: tags is stored as a JSON array string (TEXT); decode to string[]
// so the API/UI never sees the storage format. summary/tags are generated by
// the classifier at upload time (1-2 sentence summary + 3-5 short tags).
function organizerFileRow(x:any):any{
  let tags:any = null;
  if(typeof x?.tags === "string" && x.tags){
    try{ const p = JSON.parse(x.tags); if(Array.isArray(p)) tags = p.map((t:any)=>String(t)); }catch{}
  }
  return {...x, tags};
}
export async function readOrganizerFiles(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      title TEXT,
      content TEXT,
      data_url TEXT,
      description TEXT,
      folder TEXT, category TEXT, reason TEXT,
      summary TEXT, tags TEXT,
      trial BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS summary TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS tags TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ`;
    const r=await sql`SELECT id,user_id AS "userId",kind,title,content,data_url AS "dataUrl",description,folder,category,reason,summary,tags,trial,created_at AS "createdAt" FROM bys_organizer_files WHERE user_id=${userId} ORDER BY created_at DESC`;
    return (r as any[]).map(organizerFileRow);
  }
  const rows=await json(files.organizerFiles);
  return rows.filter((x:any)=>x.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
// Export-path read (M2 audit de2c7f92): same rows as readOrganizerFiles but the
// SELECT never fetches data_url — the export pack is a text-only record and the
// base64 image/PDF payloads must not be pulled into it (memory + privacy).
export async function readOrganizerFilesMeta(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      title TEXT,
      content TEXT,
      data_url TEXT,
      description TEXT,
      folder TEXT, category TEXT, reason TEXT,
      summary TEXT, tags TEXT,
      trial BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS summary TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS tags TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ`;
    const r=await sql`SELECT id,user_id AS "userId",kind,title,content,description,folder,category,reason,summary,tags,trial,created_at AS "createdAt" FROM bys_organizer_files WHERE user_id=${userId} ORDER BY created_at DESC`;
    return (r as any[]).map(organizerFileRow);
  }
  const rows=await json(files.organizerFiles);
  return rows.filter((x:any)=>x.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function addOrganizerFile(row:any){
  await ready();const sql=db();
  if(sql){
    await sql`CREATE TABLE IF NOT EXISTS bys_organizer_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      title TEXT,
      content TEXT,
      data_url TEXT,
      description TEXT,
      folder TEXT, category TEXT, reason TEXT,
      summary TEXT, tags TEXT,
      trial BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS summary TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS tags TEXT`;
    await sql`ALTER TABLE bys_organizer_files ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ`;
    await sql`INSERT INTO bys_organizer_files(id,user_id,kind,title,content,data_url,description,folder,category,reason,summary,tags,trial,created_at,extracted_at) VALUES(${row.id},${row.userId},${row.kind||"text"},${row.title||null},${row.content||null},${row.dataUrl||null},${row.description||null},${row.folder||null},${row.category||null},${row.reason||null},${row.summary||null},${row.tags?JSON.stringify(row.tags):null},${row.trial===true},${row.createdAt},${row.extractedAt||null})`;
    return;
  }
  const rows=await json(files.organizerFiles);
  rows.push({...row,kind:row.kind||"text",trial:row.trial===true,tags:row.tags||null});
  await put(files.organizerFiles,rows);
}
export async function deleteOrganizerFile(userId:string,id:string){
  await ready();const sql=db();
  if(sql){await sql`DELETE FROM bys_organizer_files WHERE id=${id} AND user_id=${userId}`;return}
  const rows=await json(files.organizerFiles);
  await put(files.organizerFiles,rows.filter((x:any)=>!(x.userId===userId&&x.id===id)));
}
export async function updateOrganizerFile(userId:string,id:string,fields:{folder?:string;category?:string;title?:string;description?:string;reason?:string;summary?:string;tags?:string[]|null}){
  await ready();const sql=db();
  if(sql){
    if (fields.folder !== undefined && fields.category !== undefined) {
      await sql`UPDATE bys_organizer_files SET folder=${fields.folder}, category=${fields.category} WHERE id=${id} AND user_id=${userId}`;
    }
    if (fields.title !== undefined) {
      await sql`UPDATE bys_organizer_files SET title=${fields.title} WHERE id=${id} AND user_id=${userId}`;
    }
    if (fields.description !== undefined) {
      await sql`UPDATE bys_organizer_files SET description=${fields.description} WHERE id=${id} AND user_id=${userId}`;
    }
    if (fields.reason !== undefined) {
      await sql`UPDATE bys_organizer_files SET reason=${fields.reason} WHERE id=${id} AND user_id=${userId}`;
    }
    if (fields.summary !== undefined) {
      await sql`UPDATE bys_organizer_files SET summary=${fields.summary} WHERE id=${id} AND user_id=${userId}`;
    }
    if (fields.tags !== undefined) {
      await sql`UPDATE bys_organizer_files SET tags=${fields.tags ? JSON.stringify(fields.tags) : null} WHERE id=${id} AND user_id=${userId}`;
    }
    const r=await sql`SELECT id,user_id AS "userId",kind,title,content,data_url AS "dataUrl",description,folder,category,reason,summary,tags,trial,created_at AS "createdAt" FROM bys_organizer_files WHERE id=${id} AND user_id=${userId}`;
    return organizerFileRow((r as any[])[0])||null;
  }
  const rows=await json(files.organizerFiles);
  const row=rows.find((x:any)=>x.userId===userId&&x.id===id);
  if(row){
    if (fields.folder !== undefined && fields.category !== undefined){row.folder=fields.folder;row.category=fields.category;}
    if (fields.title !== undefined) row.title = fields.title;
    if (fields.description !== undefined) row.description = fields.description;
    if (fields.reason !== undefined) row.reason = fields.reason;
    if (fields.summary !== undefined) row.summary = fields.summary;
    if (fields.tags !== undefined) row.tags = fields.tags;
    await put(files.organizerFiles,rows);
  }
  return organizerFileRow(row)||null;
}

// ---- Case Summary (Command Center paid feature) ------------------------------
// One persisted row per user: the generated factual overview (text), when it
// was generated, and a data_version fingerprint so the page can show whether
// the summary is current. Created in the init batch (bys_case_summary) — never
// lazy-DDL-only (that caused the 2026-08-10 login outage). JSON fallback lives
// in bys-case-summaries.json.
export async function readCaseSummary(userId:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT user_id AS "userId", generated_at AS "generatedAt", text, data_version AS "dataVersion" FROM bys_case_summary WHERE user_id=${userId}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.caseSummary);
  return rows.find((x:any)=>x.userId===userId) || null;
}
export async function writeCaseSummary(userId:string,text:string,dataVersion:string){
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_case_summary (user_id, generated_at, text, data_version) VALUES (${userId}, now(), ${text}, ${dataVersion}) ON CONFLICT (user_id) DO UPDATE SET generated_at = now(), text = EXCLUDED.text, data_version = EXCLUDED.data_version`;
    return;
  }
  const rows=await json(files.caseSummary);
  const i=rows.findIndex((x:any)=>x.userId===userId);
  const row={userId,generatedAt:new Date().toISOString(),text,dataVersion};
  if(i>=0)rows[i]=row;else rows.push(row);
  await put(files.caseSummary,rows);
}
// ---- Action Center (Command Center paid feature) ------------------------------
// One persisted row per user: the generated "what needs your attention" items
// (JSON array), when they were generated, and a data_version fingerprint so the
// page can show whether the list is current. Table created in the init batch
// (bys_action_center) — never lazy-DDL-only (that caused the 2026-08-10 login
// outage). JSON fallback lives in bys-action-center.json.
export async function readActionCenter(userId:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT user_id AS "userId", generated_at AS "generatedAt", items, data_version AS "dataVersion" FROM bys_action_center WHERE user_id=${userId}`;
    const row=(r as any[])[0];
    if(!row) return null;
    return { userId: row.userId, generatedAt: row.generatedAt, items: row.items || [], dataVersion: row.dataVersion };
  }
  const rows=await json(files.actionCenter);
  return rows.find((x:any)=>x.userId===userId) || null;
}
export async function writeActionCenter(userId:string,items:any[],dataVersion:string){
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_action_center (user_id, generated_at, items, data_version) VALUES (${userId}, now(), ${JSON.stringify(items||[])}, ${dataVersion}) ON CONFLICT (user_id) DO UPDATE SET generated_at = now(), items = EXCLUDED.items, data_version = EXCLUDED.data_version`;
    return;
  }
  const rows=await json(files.actionCenter);
  const i=rows.findIndex((x:any)=>x.userId===userId);
  const row={userId,generatedAt:new Date().toISOString(),items:items||[],dataVersion};
  if(i>=0)rows[i]=row;else rows.push(row);
  await put(files.actionCenter,rows);
}

// ---- Review events (calm-loop slice 1) --------------------------------------
// One row per completed dashboard review (the weekly-digest + momentum data).
// Idempotent by client-generated id (ON CONFLICT DO NOTHING) so a double-fired
// POST never duplicates; the SELECT after insert returns the existing row on a
// collision so the caller can detect cross-user id theft (403).
export async function insertReviewEvent(row:{id:string,userId:string,reviewId?:string,draftHash?:string,score:number,flags?:any}):Promise<any>{
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_review_events(id,user_id,review_id,draft_hash,score,flags) VALUES(${row.id},${row.userId},${row.reviewId||null},${row.draftHash||null},${row.score},${JSON.stringify(row.flags||{})}) ON CONFLICT (id) DO NOTHING`;
    const r=await sql`SELECT id,user_id AS "userId",review_id AS "reviewId",draft_hash AS "draftHash",score,flags,sent_status AS "sentStatus",sent_tone AS "sentTone",sent_at AS "sentAt",created_at AS "createdAt" FROM bys_review_events WHERE id=${row.id}`;
    return (r as any[])[0] || { id: row.id, userId: row.userId, score: row.score, flags: row.flags || {}, createdAt: new Date().toISOString() };
  }
  const rows=await json(files.reviewEvents);
  const existing=rows.find((x:any)=>x.id===row.id);
  if(!existing){
    const r={...row,flags:row.flags||{},sentStatus:null,sentTone:null,sentAt:null,createdAt:new Date().toISOString()};
    rows.push(r);
    await put(files.reviewEvents,rows);
    return r;
  }
  return existing;
}
// Update the sent-status side of a review event (sentStatus:'sent' flips
// sent_at=now(); sentTone records the dad's own tone pick). Own-row only —
// the caller checks the WHERE user_id match (no match = 404 ownership).
export async function updateReviewEventSent(userId:string,id:string,patch:{sentStatus?:string,sentTone?:string,reviewId?:string}):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    // BLOCKER-FIX: neon() parameterizes EVERY interpolation — the old
    // `, sent_at = now()` string became bound param $4, so the SET list ended
    // "...,$4" → Postgres syntax error → 500 on every PATCH. sent_at now rides
    // a COALESCE parameter exactly like the other columns (kept untouched when
    // the patch has no sentStatus:"sent", flipped to now when it does).
    const r=await sql`UPDATE bys_review_events SET sent_status=COALESCE(${patch.sentStatus||null},sent_status),sent_tone=COALESCE(${patch.sentTone||null},sent_tone),review_id=COALESCE(${patch.reviewId||null},review_id),sent_at=COALESCE(${patch.sentStatus==="sent"?new Date().toISOString():null},sent_at) WHERE user_id=${userId} AND id=${id} RETURNING id,user_id AS "userId",review_id AS "reviewId",draft_hash AS "draftHash",score,flags,sent_status AS "sentStatus",sent_tone AS "sentTone",sent_at AS "sentAt",created_at AS "createdAt"`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.reviewEvents);
  const e=rows.find((x:any)=>x.userId===userId&&x.id===id);
  if(!e)return null;
  if(patch.sentStatus!==undefined)e.sentStatus=patch.sentStatus;
  if(patch.sentTone!==undefined)e.sentTone=patch.sentTone;
  if(patch.reviewId!==undefined)e.reviewId=patch.reviewId;
  if(patch.sentStatus==="sent")e.sentAt=new Date().toISOString();
  await put(files.reviewEvents,rows);
  return e;
}
// Last `limit` scores for the momentum trend (newest first from the DB; the
// caller reverses to oldest→newest for the sparkline).
export async function reviewEventsRecent(userId:string,limit=3):Promise<any[]>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,score,sent_status AS "sentStatus",sent_tone AS "sentTone",created_at AS "createdAt" FROM bys_review_events WHERE user_id=${userId} ORDER BY created_at DESC LIMIT ${limit}`;
    return (r as any[]).map((e:any)=>({id:e.id,score:Number(e.score),sentStatus:e.sentStatus||null,sentTone:e.sentTone||null,createdAt:e.createdAt}));
  }
  const rows=await json(files.reviewEvents);
  return rows.filter((x:any)=>x.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map((e:any)=>({id:e.id,score:Number(e.score),sentStatus:e.sentStatus||null,sentTone:e.sentTone||null,createdAt:e.createdAt}));
}
// Rolling 7-day count of completed reviews (the calm "N messages reviewed this
// week" figure). No consecutive-day mechanics — never a streak.
export async function reviewEventsWeekCount(userId:string):Promise<number>{
  await ready();const sql=db();
  if(sql){const r=await sql`SELECT count(*)::int AS n FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '7 days'`;return (r as any[])[0]?.n ?? 0}
  const rows=await json(files.reviewEvents);
  const cutoff=Date.now()-7*24*60*60*1000;
  return rows.filter((x:any)=>x.userId===userId&&new Date(x.createdAt).getTime()>=cutoff).length;
}
// Per-user/day count of review-event rows (L1 silent cap): the handler stops
// POSTing past REVIEW_EVENTS_DAY_CAP so an over-eager client can't grow the
// owner-funded Neon DB unboundedly. Calendar-day based (UTC in both branches).
export async function reviewEventsCountToday(userId:string):Promise<number>{
  await ready();const sql=db();
  if(sql){const r=await sql`SELECT count(*)::int AS n FROM bys_review_events WHERE user_id=${userId} AND created_at >= date_trunc('day', now())`;return (r as any[])[0]?.n ?? 0}
  const rows=await json(files.reviewEvents);
  const start=new Date();start.setUTCHours(0,0,0,0);
  return rows.filter((x:any)=>x.userId===userId&&new Date(x.createdAt).getTime()>=start.getTime()).length;
}
// Organizer paid-classification cap (audit ac135af1 M2): per-user/UTC-day,
// increment-only — counting bys_organizer_files rows would be bypassable by a
// delete-and-reupload loop, so usage lives in its own table and deletes never
// decrement it. Past the cap the handler falls back to rule classification
// (silent — no 429, the file is still saved).
export async function organizerClassifyCountToday(userId:string):Promise<number>{
  await ready();const sql=db();
  if(sql){const r=await sql`SELECT count FROM bys_organizer_usage WHERE user_id=${userId} AND day=${new Date().toISOString().slice(0,10)}`;return (r as any[])[0]?.count ?? 0}
  const rows=await json(files.organizerUsage);
  const day=new Date().toISOString().slice(0,10);
  return rows.find((x:any)=>x.userId===userId&&x.day===day)?.count ?? 0;
}
export async function incrementOrganizerClassify(userId:string):Promise<void>{
  await ready();const sql=db();
  if(sql){await sql`INSERT INTO bys_organizer_usage(user_id,day,count) VALUES(${userId},${new Date().toISOString().slice(0,10)},1) ON CONFLICT(user_id,day) DO UPDATE SET count=bys_organizer_usage.count+1`;return}
  const rows=await json(files.organizerUsage);
  const day=new Date().toISOString().slice(0,10);
  const rec=rows.find((x:any)=>x.userId===userId&&x.day===day);
  if(rec){rec.count+=1}else{rows.push({userId,day,count:1})}
  await put(files.organizerUsage,rows);
}
// One-tap-log dedupe: a re-tap of "Yes, sent" for the same message within a day
// must not duplicate the Communication Log entry. Finds an existing
// tone='reviewed' row (same user + exact message, created < 24h ago).
export async function findRecentReviewedLog(userId:string,message:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,user_id AS "userId",message,direction,date,topic,notes,tone,child,created_at AS "createdAt",updated_at AS "updatedAt" FROM bys_log WHERE user_id=${userId} AND message=${message} AND tone='reviewed' AND created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 1`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.log);
  const cutoff=Date.now()-24*60*60*1000;
  return rows.find((x:any)=>x.userId===userId&&x.message===message&&x.tone==="reviewed"&&new Date(x.createdAt).getTime()>cutoff) || null;
}

// ---- Gift codes (calm-loop slice 2 — give-a-month referral) -----------------
// One code per confirmed $4.99 purchase; single-use (race-safe transition in
// redeemGiftCode); honest 90-day expiry enforced by the caller (handleGiftRedeem)
// and by giftCodesForGiver (active + unexpired only).
export async function insertGiftCode(row:{id:string,giverId:string,months?:number,sessionId?:string}):Promise<any>{
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_gift_codes(id,giver_id,months,session_id) VALUES(${row.id},${row.giverId},${row.months||1},${row.sessionId||null}) ON CONFLICT (id) DO NOTHING`;
    const r=await sql`SELECT id,giver_id AS "giverId",months,status,created_at AS "createdAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt" FROM bys_gift_codes WHERE id=${row.id}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.giftCodes);
  const existing=rows.find((x:any)=>x.id===row.id);
  if(!existing){
    const g={id:row.id,giverId:row.giverId,months:row.months||1,status:"active",createdAt:new Date().toISOString(),redeemedBy:null,redeemedAt:null,sessionId:row.sessionId||null};
    rows.push(g);await put(files.giftCodes,rows);return g;
  }
  return existing;
}
export async function insertConsultation(row:{userId:string,email?:string,amountCents?:number,sessionId:string}):Promise<any>{
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_consultations(user_id,email,amount_cents,session_id) VALUES(${row.userId},${row.email||null},${row.amountCents||0},${row.sessionId}) ON CONFLICT (session_id) DO NOTHING`;
    const r=await sql`SELECT id,user_id AS "userId",email,amount_cents AS "amountCents",session_id AS "sessionId",created_at AS "createdAt" FROM bys_consultations WHERE session_id=${row.sessionId}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.consultations);
  const existing=rows.find((x:any)=>x.sessionId===row.sessionId);
  if(!existing){
    const c={userId:row.userId,email:row.email||null,amountCents:row.amountCents||0,sessionId:row.sessionId,createdAt:new Date().toISOString()};
    rows.push(c);await put(files.consultations,rows);return c;
  }
  return existing;
}
// ---- Attorney Prep Pack (one-time 2026-08-12, Stage 1 money path) -----------
// Durable grant row — mirrors bys_consultations exactly (lazy DDL, session_id
// UNIQUE idempotency, JSON fallback). The confirm handler ALSO stamps
// profile.attorneyPrep so the sync entitlement check needs no DB read; this row
// is the canonical durable record (re-download entitlement, audit trail).
export async function insertAttorneyPack(row:{userId:string,email?:string,amountCents?:number,sessionId:string}):Promise<any>{
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_attorney_packs(user_id,email,amount_cents,session_id) VALUES(${row.userId},${row.email||null},${row.amountCents||0},${row.sessionId}) ON CONFLICT (session_id) DO NOTHING`;
    const r=await sql`SELECT id,user_id AS "userId",email,amount_cents AS "amountCents",session_id AS "sessionId",created_at AS "createdAt" FROM bys_attorney_packs WHERE session_id=${row.sessionId}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.attorneyPacks);
  const existing=rows.find((x:any)=>x.sessionId===row.sessionId);
  if(!existing){
    const c={userId:row.userId,email:row.email||null,amountCents:row.amountCents||0,sessionId:row.sessionId,createdAt:new Date().toISOString()};
    rows.push(c);await put(files.attorneyPacks,rows);return c;
  }
  return existing;
}
export async function attorneyPacksForUser(userId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,user_id AS "userId",email,amount_cents AS "amountCents",session_id AS "sessionId",created_at AS "createdAt" FROM bys_attorney_packs WHERE user_id=${userId} ORDER BY created_at DESC`;
    return r as any[];
  }
  const rows=await json(files.attorneyPacks);
  return rows.filter((x:any)=>x.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));
// 24-hour free trial (owner 2026-08-13): ONE trial per person, ever. user_id is
// the PK — a second INSERT for the same person is a no-op (race-safe). Expiry
// is pure timestamp math (started_at + 24h) compared at read/grant time; no
// cron, no charges, nothing sneaky. getTrial is the durable record; the
// effective entitlement is mirrored onto profile.trialUntil by the API so the
// synchronous userTier() gate can treat the window as the top paid tier.
export async function getTrial(userId:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT user_id AS "userId",started_at AS "startedAt",expires_at AS "expiresAt",source FROM bys_trials WHERE user_id=${userId}`;
    return (r as any[])[0]||null;
  }
  const rows=await json(files.trials);
  return rows.find((x:any)=>x.userId===userId)||null;
}
export async function startTrial(userId:string,source:string):Promise<{row:any,created:boolean}>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`INSERT INTO bys_trials(user_id,expires_at,source) VALUES(${userId}, now() + interval '24 hours', ${source}) ON CONFLICT (user_id) DO NOTHING RETURNING user_id AS "userId",started_at AS "startedAt",expires_at AS "expiresAt",source`;
    if((r as any[]).length>0)return {row:(r as any[])[0],created:true};
    const existing=await sql`SELECT user_id AS "userId",started_at AS "startedAt",expires_at AS "expiresAt",source FROM bys_trials WHERE user_id=${userId}`;
    return {row:(existing as any[])[0]||null,created:false};
  }
  const rows=await json(files.trials);
  const existing=rows.find((x:any)=>x.userId===userId);
  if(existing)return {row:existing,created:false};
  const t={userId,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),source};
  rows.push(t);await put(files.trials,rows);return {row:t,created:true};
}
export async function getGiftCode(code:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,giver_id AS "giverId",months,status,created_at AS "createdAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt" FROM bys_gift_codes WHERE id=${code}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.giftCodes);
  return rows.find((x:any)=>x.id===code) || null;
}
// L3: the code already minted for a given Stripe session (if any). Combined
// with the UNIQUE session_id column this makes double-confirm safe: the first
// mint wins, every later confirm reads this row back instead of minting again.
export async function getGiftCodeBySession(sessionId:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,giver_id AS "giverId",months,status,created_at AS "createdAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt" FROM bys_gift_codes WHERE session_id=${sessionId}`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.giftCodes);
  return rows.find((x:any)=>x.sessionId===sessionId) || null;
}
// Race-safe single transition: only an 'active' row can flip to 'redeemed'; a
// concurrent double-redeem makes exactly one UPDATE match (the other returns no
// row → the caller takes the 409 already-used path).
export async function redeemGiftCode(code:string,userId:string):Promise<any|null>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`UPDATE bys_gift_codes SET status='redeemed',redeemed_by=${userId},redeemed_at=now() WHERE id=${code} AND status='active' RETURNING id,giver_id AS "giverId",months,status,created_at AS "createdAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt"`;
    return (r as any[])[0] || null;
  }
  const rows=await json(files.giftCodes);
  const g=rows.find((x:any)=>x.id===code&&x.status==="active");
  if(!g)return null;
  g.status="redeemed";g.redeemedBy=userId;g.redeemedAt=new Date().toISOString();
  await put(files.giftCodes,rows);
  return g;
}
// The giver's active, unexpired codes (90-day window), newest first — survives
// a reload of the pricing success surface.
export async function giftCodesForGiver(giverId:string):Promise<any[]>{
  await ready();const sql=db();
  if(sql){
    const r=await sql`SELECT id,giver_id AS "giverId",months,status,created_at AS "createdAt",redeemed_by AS "redeemedBy",redeemed_at AS "redeemedAt" FROM bys_gift_codes WHERE giver_id=${giverId} AND status='active' AND created_at > now() - interval '90 days' ORDER BY created_at DESC`;
    return r as any[];
  }
  const rows=await json(files.giftCodes);
  const cutoff=Date.now()-90*24*60*60*1000;
  return rows.filter((x:any)=>x.giverId===giverId&&x.status==="active"&&new Date(x.createdAt).getTime()>cutoff).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
// ---- Weekly digest (calm-loop slice 2 — Steady+) ----------------------------
// One call returns every number the digest card shows: rolling 7-day counts
// (reviewed/sent), calmest+stormiest rows (factual scores, no commentary),
// tone mix of SENT picker tones, avg score this week vs days 7-14 ago (trend
// basis — null prevAvg means no comparison, never an invented trend), and the
// last-3 scores oldest→newest (sparkline).
export async function reviewEventsDigest(userId:string):Promise<any>{
  await ready();const sql=db();
  if(sql){
    const [countR,sentR,calmestR,stormiestR,toneR,avgR,prevR,recent]=await Promise.all([
      sql`SELECT count(*)::int AS n FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '7 days'`,
      sql`SELECT count(*)::int AS n FROM bys_review_events WHERE user_id=${userId} AND sent_status='sent' AND created_at >= now() - interval '7 days'`,
      sql`SELECT score,created_at AS "at" FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '7 days' ORDER BY score DESC LIMIT 1`,
      sql`SELECT score,created_at AS "at" FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '7 days' ORDER BY score ASC LIMIT 1`,
      sql`SELECT sent_tone AS "tone",count(*)::int AS n FROM bys_review_events WHERE user_id=${userId} AND sent_status='sent' AND sent_tone IS NOT NULL AND created_at >= now() - interval '7 days' GROUP BY sent_tone`,
      sql`SELECT avg(score)::float8 AS a FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '7 days'`,
      sql`SELECT avg(score)::float8 AS a FROM bys_review_events WHERE user_id=${userId} AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days'`,
      reviewEventsRecent(userId,3)
    ]);
    const toneMix:any={};
    for(const t of (toneR as any[])) if(t.tone)toneMix[t.tone]=Number(t.n);
    const calmest=(calmestR as any[])[0]?{score:Number((calmestR as any[])[0].score),at:(calmestR as any[])[0].at}:null;
    const stormiest=(stormiestR as any[])[0]?{score:Number((stormiestR as any[])[0].score),at:(stormiestR as any[])[0].at}:null;
    const avg=(avgR as any[])[0]?.a!=null?Number((avgR as any[])[0].a):null;
    const prevAvg=(prevR as any[])[0]?.a!=null?Number((prevR as any[])[0].a):null;
    return {reviewed:(countR as any[])[0]?.n??0,sent:(sentR as any[])[0]?.n??0,calmest,stormiest,toneMix,avg,prevAvg,recent:recent.slice().reverse()};
  }
  const rows=await json(files.reviewEvents);
  const cutoff=Date.now()-7*24*60*60*1000;
  const week=rows.filter((x:any)=>x.userId===userId&&new Date(x.createdAt).getTime()>=cutoff);
  const prevCutoff=cutoff-7*24*60*60*1000;
  const prev=rows.filter((x:any)=>x.userId===userId&&new Date(x.createdAt).getTime()>=prevCutoff&&new Date(x.createdAt).getTime()<cutoff);
  const sorted=week.slice().sort((a:any,b:any)=>Number(b.score)-Number(a.score));
  const toneMix:any={};
  for(const e of week){if(e.sentStatus==="sent"&&e.sentTone)toneMix[e.sentTone]=(toneMix[e.sentTone]||0)+1}
  const avg=week.length?(week.reduce((s:number,x:any)=>s+Number(x.score),0)/week.length):null;
  const prevAvg=prev.length?(prev.reduce((s:number,x:any)=>s+Number(x.score),0)/prev.length):null;
  return {
    reviewed:week.length,
    sent:week.filter((x:any)=>x.sentStatus==="sent").length,
    calmest:sorted[0]?{score:Number(sorted[0].score),at:sorted[0].createdAt}:null,
    stormiest:sorted.length>1?{score:Number(sorted[sorted.length-1].score),at:sorted[sorted.length-1].createdAt}:sorted[0]?{score:Number(sorted[0].score),at:sorted[0].createdAt}:null,
    toneMix,avg,prevAvg,
    recent:rows.filter((x:any)=>x.userId===userId).sort((a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,3).reverse()
  };
}

// ---- TikTok Content Posting (bys_tiktok_tokens / bys_tiktok_publishes) ------
// Single-row token store (id='main'). NEVER returned to clients — tokens are
// read server-side only, in src/lib/server-api.ts handlers.
export async function upsertTikTokToken(tok:{accessToken:string,refreshToken?:string|null,openId?:string|null,scope?:string|null,expiresAt:number}){
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_tiktok_tokens(id,access_token,refresh_token,open_id,scope,expires_at,updated_at) VALUES('main',${tok.accessToken},${tok.refreshToken||null},${tok.openId||null},${tok.scope||null},${tok.expiresAt},now()) ON CONFLICT(id) DO UPDATE SET access_token=EXCLUDED.access_token,refresh_token=COALESCE(EXCLUDED.refresh_token,bys_tiktok_tokens.refresh_token),open_id=COALESCE(EXCLUDED.open_id,bys_tiktok_tokens.open_id),scope=COALESCE(EXCLUDED.scope,bys_tiktok_tokens.scope),expires_at=EXCLUDED.expires_at,updated_at=now()`;
    return;
  }
  await put(files.tiktokTokens,{accessToken:tok.accessToken,refreshToken:tok.refreshToken||null,openId:tok.openId||null,scope:tok.scope||null,expiresAt:tok.expiresAt});
}
export async function readTikTokToken():Promise<{accessToken:string,refreshToken:string|null,openId:string|null,scope:string|null,expiresAt:number}|null>{
  await ready();const sql=db();
  if(sql){
    const r:any[]=await sql`SELECT access_token AS "accessToken",refresh_token AS "refreshToken",open_id AS "openId",scope,expires_at AS "expiresAt" FROM bys_tiktok_tokens WHERE id='main'`;
    return r.length?{accessToken:String(r[0].accessToken),refreshToken:r[0].refreshToken?String(r[0].refreshToken):null,openId:r[0].openId?String(r[0].openId):null,scope:r[0].scope?String(r[0].scope):null,expiresAt:Number(r[0].expiresAt||0)}:null;
  }
  try{const v:any=JSON.parse(await (await fs()).readFile(files.tiktokTokens,"utf8"));return v&&v.accessToken?v:null}catch{return null}
}
export async function addTikTokPublish(row:{publishId:string|null,videoUrl:string,caption:string,status:string,apiStatus:string}){
  await ready();const sql=db();
  if(sql){
    await sql`INSERT INTO bys_tiktok_publishes(publish_id,video_url,caption,status,api_status) VALUES(${row.publishId},${row.videoUrl},${row.caption||null},${row.status},${row.apiStatus})`;
    return;
  }
  const rows:any[]=await json(files.tiktokPublishes);
  rows.push({publishId:row.publishId,videoUrl:row.videoUrl,caption:row.caption,status:row.status,apiStatus:row.apiStatus,createdAt:new Date().toISOString()});
  await put(files.tiktokPublishes,rows);
}
export async function readTikTokPublishes(limit=20):Promise<any[]>{
  await ready();const sql=db();
  if(sql){return await sql`SELECT publish_id AS "publishId",video_url AS "videoUrl",caption,status,api_status AS "apiStatus",created_at AS "createdAt" FROM bys_tiktok_publishes ORDER BY id DESC LIMIT ${limit}` as any[]}
  const rows:any[]=await json(files.tiktokPublishes);
  return rows.slice(-limit).reverse();
}

// Owner dashboard — Customers view (build 2, owner 2026-08-13). Raw material
// for /api/metrics/customers: every user account, every trial row, the
// account_created events (for signup attribution — source/campaign ride in the
// event meta, stamped from the session at ingest), the day+all-time counts for
// the customer-action big numbers (paid / review_completed / checkout_started
// events), and the sessions for the account_created vids (landing path + the
// first-write-wins attribution columns). All live table reads; nothing is
// fabricated or estimated.
export async function customerMetrics():Promise<any>{
  await ready();const sql=db();
  if(!sql) return { users:[], trials:[], acEvents:[], paidEvents:[], reviewEvents:[], checkoutEvents:[], sessions:[] };
  const [users, trials, acEvents, paidEvents, reviewEvents, checkoutEvents] = await Promise.all([
    sql`SELECT id,email,created_at AS "createdAt",confirmed_at AS "confirmedAt",profile FROM bys_users`,
    sql`SELECT user_id AS "userId",started_at AS "startedAt",expires_at AS "expiresAt",source FROM bys_trials`,
    sql`SELECT vid,ts,meta FROM bys_events WHERE name='account_created'`,
    sql`SELECT ts FROM bys_events WHERE name='paid'`,
    sql`SELECT ts FROM bys_events WHERE name='review_completed'`,
    sql`SELECT ts FROM bys_events WHERE name='checkout_started'`,
  ]);
  const vids:string[] = [...new Set((acEvents as any[]).map((e:any)=>e.vid))];
  let sessions:any[] = [];
  if (vids.length) {
    sessions = (await sql`SELECT vid,source,medium,campaign,landing_path AS "landingPath",entry_path AS "entryPath" FROM bys_sessions WHERE vid = ANY(${vids})`) as any[];
  }
  return { users, trials, acEvents, paidEvents, reviewEvents, checkoutEvents, sessions };
}
