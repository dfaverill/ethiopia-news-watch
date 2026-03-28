# Ethiopia News Watch

Ethiopia News Watch is a comparison-first dashboard for Ethiopia breaking news and politics. It keeps the approved Reuters-like UI, but now runs on a hardened server-side aggregation pipeline with per-source failure isolation, persistent local cache state, structured diagnostics, and focused tests.

## Purpose

The app is built to answer one practical question quickly:

- What are the main Ethiopia-related storylines right now?
- Which sources are covering them?
- Which sources are degraded, using fallback surfaces, timed out, or stale?

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- `cheerio`
- `rss-parser`
- `vitest`

## Architecture Overview

Main runtime layers:

- `src/app/page.tsx`
  - Server-renders the initial dashboard payload.
- `src/app/api/coverage/route.ts`
  - Handles cached reads with `GET /api/coverage`.
  - Handles live refresh with `POST /api/coverage`.
  - Local-only debug output is available with `GET /api/coverage?debug=1`.
- `src/app/api/health/route.ts`
  - Lightweight health endpoint for production probes and Render health checks.
- `src/lib/news/aggregate.ts`
  - Orchestrates refresh.
  - Applies cache logic.
  - Merges failed live results with persisted source snapshots when possible.
- `src/lib/news/persistence.ts`
  - Reads and writes the durable local cache file.
- `src/lib/news/http.ts`
  - Adds timeouts, retries, and typed fetch errors.
- `src/lib/news/relevance.ts`
  - Scores Ethiopia relevance and topic tags.
- `src/lib/news/grouping.ts`
  - Deduplicates and groups related coverage into storyline cards.
- `src/lib/news/sources/*.ts`
  - One adapter per source.

## Source Adapter Structure

Each adapter returns normalized source results using:

```ts
{
  source,
  items,
  status,
  healthKind,
  note,
  sourceType,
  attemptedAt,
  lastSuccessfulAt,
  durationMs,
  usedCachedItems,
  cacheSource,
  diagnostics,
  metrics
}
```

Normalized items keep only the minimum needed:

```ts
{
  id,
  source,
  title,
  url,
  publishedAt,
  snippet,
  section,
  language,
  sourceType,
  matchedKeywords,
  topicTags,
  relevanceScore
}
```

## Source Handling By Source

- Reuters
  - Uses official Reuters outbound news sitemap pages first.
  - Falls back to Google News RSS scoped to Reuters when official coverage is unavailable or insufficient.
- Addis Standard
  - Direct RSS/listing/API requests are bot-protected in this environment.
  - Uses Google News RSS fallback and is marked `Fallback` when successful.
- The Reporter Ethiopia
  - Uses the public `latest-news-in-ethiopia` feed.
- Ethiopia Insight
  - Uses the main public feed.
- ENA
  - Parses the English homepage and then article metadata pages.
- NEBE
  - Parses the public archive and article pages.
- VOA Amharic
  - Uses the direct public Ethiopia/Eritrea RSS feed instead of brittle page scraping.

## Refresh And Data Flow

1. The page requests a dashboard payload on the server.
2. `aggregate.ts` decides whether to serve:
   - fresh in-memory data
   - fresh persisted-on-disk data
   - or a new live refresh
3. Every source adapter runs independently.
4. One bad source cannot break the full refresh.
5. Failed sources can reuse their previous persisted source snapshot when available.
6. Relevance scoring filters items to Ethiopia-related coverage.
7. Deduping and grouping produce storyline comparison cards.
8. The dashboard refresh button calls `POST /api/coverage`.

## Caching And Persistence

There are now two cache layers:

- In-memory cache
  - Fast reuse within the running server process.
  - TTL: 10 minutes.
- Durable local cache
  - File: `.cache/coverage-state.json` locally, or the path under `NEWS_WATCH_CACHE_DIR` when configured
  - Stores:
    - the last usable dashboard payload
    - per-source results
    - refresh timestamps
    - source diagnostics

Behavior:

- Server restart does not wipe the last usable dashboard snapshot.
- If a refresh fails badly, the app can serve the last persisted usable result instead of collapsing to empty.
- If one source fails but a previous source snapshot exists, the dashboard can keep using that source's cached items and mark the source accordingly.

## Failure Handling

The app distinguishes source health more clearly now:

- `Healthy`
  - Live source succeeded normally.
- `Fallback`
  - Live fallback surface was used.
- `Cached`
  - Live source failed and the app reused the previous persisted source result.
- `Timed out`
  - Source exceeded the fetch timeout.
- `HTTP error`
  - Source returned a bad status.
- `Parse issue`
  - Source content could not be parsed.
- `No matches`
  - Source loaded, but nothing passed the Ethiopia relevance filter.
- `Failed`
  - No usable result was available.

The UI keeps Source Status, Latest by Source, and grouped storyline rows usable even under partial failure.

## Debugging And Observability

Server logs are structured JSON-style events through `src/lib/news/logger.ts`.

Useful debug endpoint for local development:

- `/api/coverage?debug=1`
  - Returns the dashboard payload plus the persisted cache path.
  - The payload includes per-source debug summaries with counts and diagnostics.
  - Disabled in production responses.

Optional verbose logging:

- Set `NEWS_WATCH_DEBUG=1` before running the app.

Optional persistent-cache location override:

- Set `NEWS_WATCH_CACHE_DIR` to an absolute directory path.
- This is recommended for Render so cache writes go to the attached persistent disk.

## Tests

Focused tests cover:

- relevance scoring and false-positive control
- topic tagging and anchor logic
- text cleanup and mojibake repair
- date extraction
- dedupe and grouping behavior
- source normalization helpers

Run:

```powershell
Set-Location "D:\Ethiopia\News app\ethiopia-news-app"
$env:Path = "C:\Program Files\nodejs;$env:Path"
& "C:\Program Files\nodejs\npm.cmd" run test
```

## Local Run

```powershell
Set-Location "D:\Ethiopia\News app\ethiopia-news-app"
$env:Path = "C:\Program Files\nodejs;$env:Path"
& "C:\Program Files\nodejs\npm.cmd" run dev
```

Default local URL:

- [http://localhost:3000](http://localhost:3000)

## Render Deployment

The canonical deployment definition for this repo is [render.yaml](D:/Ethiopia/News%20app/ethiopia-news-app/render.yaml). Prefer deploying it as a Render Blueprint so the service shape, region, instance count, disk, health check, and cache-directory environment variable all come from the repo.

Recommended service shape:

- Create a `Web Service`
- Run it as a single persistent instance
- Attach a persistent disk

Exact settings:

- Service type: `Web Service`
- Runtime: `Node`
- Region: `Oregon`
- Plan: `Starter` or higher
- Instance count: `1`
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`

Required environment variables:

- `NEWS_WATCH_CACHE_DIR=/var/data/ethiopia-news-watch`

Node version:

- This repo includes [.node-version](D:/Ethiopia/News%20app/ethiopia-news-app/.node-version), pinned to `22.22.0`, which Render supports directly.

Persistent disk:

- Attach a persistent disk when creating the service
- Recommended mount path: `/var/data`
- Recommended initial size: `5 GB`
- Keep this service at one instance because the app uses local persisted cache state

Notes:

- The repo includes [render.yaml](D:/Ethiopia/News%20app/ethiopia-news-app/render.yaml) as the single source of truth for the recommended deployment setup.
- Render disks are only available on paid web services, and a disk-backed service cannot scale horizontally.
- Because disk-backed services prevent zero-downtime deploys on Render, brief downtime during deploys is expected for this first release shape.

Manual steps in Render:

1. Create a new Blueprint from this repo so Render reads [render.yaml](D:/Ethiopia/News%20app/ethiopia-news-app/render.yaml).
2. Confirm the paid `Starter` plan and the persistent disk creation.
3. Click deploy.

Manual dashboard entry should only be used if Blueprint creation is unavailable.

## Verification Commands

```powershell
Set-Location "D:\Ethiopia\News app\ethiopia-news-app"
$env:Path = "C:\Program Files\nodejs;$env:Path"
& "C:\Program Files\nodejs\npm.cmd" run test
& "C:\Program Files\nodejs\npm.cmd" run lint
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npm.cmd" audit
```

## Public Deployment Safety

Security hardening now in place:

- global security headers are set in `next.config.ts`
- `X-Powered-By` is disabled
- the refresh endpoint now uses same-origin `POST /api/coverage`
- the refresh path has per-IP rate limiting and a short refresh cooldown
- unsafe non-HTTP publisher URLs are stripped before reaching the UI
- debug diagnostics are redacted from normal public payloads

Public hosting recommendation:

- Safe enough now for a first public release on a single persistent Node host behind HTTPS.
- If you deploy on Vercel, treat the current file-based `.cache/coverage-state.json` persistence and in-process rate limiting as best-effort only.
- For a stronger Vercel deployment, move persistence and rate limiting to a shared external store such as Redis/KV/Postgres, and add Vercel Firewall or edge-layer rate limiting for `/api/coverage`.

Known production caveats:

- The current rate limiter is process-local, so it does not protect across multiple instances by itself.
- The current durable cache depends on local filesystem writes and may not persist reliably on serverless platforms.
- Upstream publishers can still throttle or block scraping surfaces, so source degradation remains a normal operational condition.

## Limitations

- Some sources are still structurally brittle or actively bot-protected.
- Google News fallback links may still be redirect URLs instead of direct publisher URLs.
- Grouping is heuristic and intentionally conservative.
- Upstream metadata quality is inconsistent, especially dates and snippets on some listing surfaces.
- Persistent cache is local-file based and intended for local/dev reliability, not multi-user deployment.
- No full article bodies are fetched or stored.

## Known Brittle Sources

- Addis Standard
  - Bot protection blocks direct server-side feed/listing access here.
- Reuters
  - Official page scraping is brittle; sitemap plus fallback is the practical approach.
- VOA Amharic
  - Coverage quality depends on the feed mix inside the Ethiopia/Eritrea RSS stream.

## Best Next Improvements

- Resolve Google News redirect URLs to direct publisher URLs when possible.
- Add richer entity extraction for better multi-source storyline clustering.
- Add fixture-based adapter tests for each source.
- Add a small admin/debug page for source diagnostics instead of API-only debug output.
- Add optional scheduled refresh or background warm-up for local long-running use.
