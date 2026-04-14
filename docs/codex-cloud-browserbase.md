# Codex Cloud + Browserbase Setup

This app can now run its Playwright-driven NotebookLM and social scraping flows in two modes:

- local persistent Playwright profile
- Browserbase-managed cloud browser sessions when `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are configured

## What this unlocks

- Codex web can edit the repo and run the app in a Linux cloud workspace.
- NotebookLM, Facebook, X, Addis Standard, and Google News browser tasks can use Browserbase instead of a local Edge profile.
- Browserbase Contexts can persist sign-in state across sessions, which is the closest cloud equivalent to the previous local browser profile flow.

## Required Codex Cloud Environment

Set the setup script to:

```bash
npm ci
npx playwright install chromium
```

Turn agent internet access on and allow at least:

- `registry.npmjs.org`
- `playwright.download.prss.microsoft.com`
- `notebooklm.google.com`
- `accounts.google.com`
- `facebook.com`
- `m.facebook.com`
- `l.facebook.com`
- `x.com`
- `t.me`
- `youtube.com`
- `fonts.googleapis.com`
- `fonts.gstatic.com`
- `api.browserbase.com`
- `browserbase.com`

## Required Runtime Environment Variables

Add these in Codex cloud:

```text
OPENAI_API_KEY=...
OPENAI_SUMMARY_MODEL=gpt-5.4-mini
OPENAI_PODCAST_SCRIPT_MODEL=gpt-5.4
OPENAI_AUDIO_TRANSLATION_MODEL=whisper-1
OPENAI_TEXT_TRANSLATION_MODEL=gpt-5.4-mini
ELEVENLABS_API_KEY=...
ELEVENLABS_PODCAST_MODEL=eleven_v3
ELEVENLABS_HOST_A_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_HOST_B_VOICE_ID=Aw4FAjKCGjjNkVhN1Xmq
NOTEBOOKLM_BROWSER_CHANNEL=chromium
NOTEBOOKLM_PODCAST_LANGUAGE=English
NOTEBOOKLM_BROWSER_HEADLESS=1
NOTEBOOKLM_GENERATION_TIMEOUT_MINUTES=25
NEWS_WATCH_CACHE_DIR=/workspace/ethiopia-news-watch/.cache
ADDIS_STANDARD_BROWSER_CHANNEL=chromium
ADDIS_STANDARD_BROWSER_HEADLESS=1
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
BROWSERBASE_KEEP_ALIVE=1
```

Optional:

```text
BROWSERBASE_CONTEXT_ID=...
BROWSERBASE_REGION=...
BROWSERBASE_CONTEXT_CACHE_PATH=/workspace/ethiopia-news-watch/.cache/browserbase-contexts.json
```

Do not copy your old Windows-only browser profile paths into Codex cloud.

## Worker-backed mode (for runtimes that cannot attach CDP directly)

If your Codex runtime can call HTTPS APIs but cannot open outbound Browserbase CDP websockets,
set:

```text
AUTOMATION_WORKER_URL=https://<your-worker-host>
AUTOMATION_WORKER_TOKEN=...
AUTOMATION_WORKER_TIMEOUT_MS=120000
```

When `AUTOMATION_WORKER_URL` is set, these scripts delegate to the worker instead of running
Playwright locally:

- `scripts/collect-facebook-posts.mjs`
- `scripts/extract-facebook-post.mjs`
- `scripts/collect-x-posts.mjs`
- `scripts/extract-addis-standard-article.mjs`

The worker is expected to expose:

- `POST /tasks/collect-facebook-posts`
- `POST /tasks/extract-facebook-post`
- `POST /tasks/collect-x-posts`
- `POST /tasks/extract-addis-standard-article`
- `GET /health` (liveness)
- `GET /ready` (readiness: validates required env)

Each endpoint should accept the script input payload and return JSON (or `{ "result": ... }`).

Run the worker locally:

```bash
npm run worker
```

For local-only testing without auth, set:

```text
AUTOMATION_WORKER_ALLOW_NO_TOKEN=1
```

Minimal deployment notes:

- Deploy `scripts/automation-worker-server.mjs` in a runtime that can reach Browserbase CDP websocket hosts.
- Set `AUTOMATION_WORKER_TOKEN` and send it as `Authorization: Bearer <token>` from callers.
- Keep `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` configured on the worker runtime.

### Smallest Render deployment path

This repo now includes a second Render web service blueprint:

- `ethiopia-news-watch-automation-worker`
- build: `npm ci`
- start: `npm run worker`
- health: `GET /ready`

After provisioning the worker service, set on your app runtime:

```text
AUTOMATION_WORKER_URL=https://ethiopia-news-watch-automation-worker.onrender.com
AUTOMATION_WORKER_TOKEN=<same token configured on worker>
```

## Browserbase Login Flow

1. Start a NotebookLM or Facebook task from Codex web.
2. If the automation detects a sign-in requirement, it writes an `auth-required` state with a Browserbase session inspector URL.
3. Open that Browserbase session URL.
4. Sign in manually inside Browserbase Live View.
5. Close the Browserbase session tab or let the automation continue.
6. Future sessions reuse the same Browserbase Context and should stay signed in until the site invalidates the session.

Browserbase context behavior is documented here:

- [Create a browser session](https://docs.browserbase.com/platform/browser/getting-started/create-browser-session)
- [Using a browser session](https://docs.browserbase.com/platform/browser/getting-started/using-browser-session)
- [Contexts](https://docs.browserbase.com/platform/browser/core-features/contexts)
- [Downloads](https://docs.browserbase.com/platform/browser/files/downloads)

## First Codex Web Prompt

Use this after the environment is configured:

```text
Inspect the repo, confirm the Codex cloud environment has npm deps, Playwright Chromium, and Browserbase env vars configured, then run the app and report whether the homepage loads.

After that, audit the NotebookLM and social scraping flows in:

/workspace/ethiopia-news-watch/src/lib/notebooklm-podcast.ts
/workspace/ethiopia-news-watch/src/lib/notebooklm-social-harvest.ts
/workspace/ethiopia-news-watch/src/lib/notebooklm-source-harvest.ts
/workspace/ethiopia-news-watch/scripts/notebooklm-podcast-worker.mjs
/workspace/ethiopia-news-watch/scripts/collect-facebook-posts.mjs
/workspace/ethiopia-news-watch/scripts/extract-facebook-post.mjs
/workspace/ethiopia-news-watch/scripts/collect-x-posts.mjs
/workspace/ethiopia-news-watch/scripts/extract-addis-standard-article.mjs

Then continue with the next code task I give you.
```

## Current Known Gaps

- Browserbase is now wired in as a transport layer, but sign-in still depends on manual Live View the first time.
- Codex cloud still cannot control your actual Windows desktop browser.
- Durable session reuse now lives in Browserbase Contexts, not local Edge profiles.
