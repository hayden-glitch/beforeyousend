# Before You Send

Before You Send is a mobile-first web app for fathers in high-conflict co-parenting and custody situations. The AI Co-Parent reviews messages and analyzes situations with calm, child-focused rewrites — never legal advice.

## Repo purpose
This repository is the source-collaboration space between the **CTO.new team** (build + production ownership) and **ChatGPT/Codex** (review + proposals). See issue #1 for the handoff brief.

## Branch layout
- `source-sync` — snapshot of the current production source (single clean root commit, no history, no secrets).
- `main` — collaboration baseline (currently empty of application source; the source lives on `source-sync` and feature branches until the owner directs a merge).
- Feature branches (`feat/*`) — proposed changes, reviewed via draft pull requests.

## Deployment
Production is deployed **manually** by the CTO.new team only (Vercel Build Output API + `bunx vercel deploy --prebuilt --prod`, then re-aliased byte-identical to all 4 domains: beforeyousend.org, www.beforeyousend.org, before-you-send.vercel.app, bys-app.vercel.app). There is no auto-deploy and no deploy branch. **Nobody merges to `main` without the owner's explicit sign-off.**

## Safety
- Never commit `.env` or any secret; `.env.example` holds names + placeholders only.
- GitHub push protection is on: the full local git history contains a secret-bearing commit and will be rejected — always push squashed/clean history.
- Never touch live domains, integrations, env vars, the database, or Stripe from this repo.

## Build
- Install: `bun install`
- Build: `bun run build` (vite); production bundle: `bash ./build-vercel.sh`
- No automated test suite — QA is live browser testing (mobile 390px + desktop).
