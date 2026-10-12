# SHRT

A URL shortener with custom aliases, expiring links, QR codes and click analytics.

- **Frontend** — React 19 + Vite (`frontend/`), deployed on Vercel
- **Backend** — Express 5 + Prisma on Neon Postgres (`backend/`), deployed on Render
- **Auth** — Neon Auth (Better Auth); the API verifies bearer JWTs against the JWKS endpoint

## Features

- Shorten any HTTP(S) URL, with an optional custom alias (`/my-launch`) and live availability check
- Expiry presets (1 hour → 30 days) or a custom date; expired links show visitors a branded page
- Password-protected links and click limits (e.g. stop after 100 visits)
- Tags with filtering, a UTM builder on the create form, and CSV export of your links
- Dashboard with totals, search, filters and sorting; edit a link's destination or expiry, or delete it
- Analytics (per link and account-wide): clicks and unique visitors over 7/30/90 days vs the previous period, traffic sources (QR scans, UTM, grouped referrers), countries, devices, browsers, OS, an hour × weekday heatmap, and 14-day sparklines — all in the viewer's timezone
- Bots and link-preview fetchers (WhatsApp, Slack, X…) are redirected but not counted, so they don't inflate stats or use up click limits
- QR code for every link, downloadable as PNG
- Settings: change password, API keys for scripts, full JSON data export, account deletion
- Rate limiting on link creation and redirects, security headers, graceful shutdown, health probes

## Local development

Requires Node 22+.

```bash
npm install
cp backend/.env.example backend/.env     # fill in Neon DB + auth URLs
cp frontend/.env.example frontend/.env   # set VITE_NEON_AUTH_URL
npm run db:migrate -w backend
npm run dev:backend                      # http://localhost:3000
npm run dev:frontend                     # http://localhost:5173 (proxies /api)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm test -w backend` | Unit tests, plus analytics SQL tests on an in-memory Postgres (PGlite) built from the migrations |
| `npm run build -w backend` | Type-check and compile the API to `backend/dist` |
| `npm run db:migrate -w backend` | Apply pending Prisma migrations (`prisma migrate deploy`) |
| `npm run build -w frontend` | Type-check and build the SPA to `frontend/dist` |
| `npm run lint -w frontend` | Lint the frontend with oxlint |

## API

`/api/urls` routes accept `Authorization: Bearer <Neon Auth JWT>` or `Bearer <API key>` (create keys in Settings). `/api/account` routes require a signed-in session; API keys are rejected there.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/urls` | `{ originalUrl, alias?, expiresAt?, tags?, maxClicks?, password? }` → `201`; `409` if the alias is taken |
| `GET` | `/api/urls/alias-availability?alias=x` | `{ available, reason? }` |
| `PATCH` | `/api/urls/:id` | Any of `{ originalUrl, expiresAt, tags, maxClicks, password }`; `null` clears expiry, limit or password |
| `DELETE` | `/api/urls/:id` | `204`; also deletes the link's click history |
| `GET` | `/api/urls?tz=` | Your links with click stats and a 14-day sparkline |
| `GET` | `/api/urls/:id/analytics?startDate&endDate&tz` | Totals vs previous period, daily clicks/visitors, breakdowns, heatmap (≤ 90 days) |
| `GET` | `/api/urls/overview?startDate&endDate&tz` | The same across all your links, plus top links |
| `GET` | `/:shortCode` | `302` to the destination; `404`/`410` (expired or click limit reached) as HTML for browsers, JSON otherwise; protected links show a password form |
| `POST` | `/:shortCode` | `password` (form or JSON) unlocks a protected link → `303`; 10 wrong tries per IP per 15 min |
| `GET`/`POST` | `/api/account/keys` | List keys / create one with `{ name }` (the key is only returned once) |
| `DELETE` | `/api/account/keys/:id` | Revoke a key |
| `GET` | `/api/account/export` | All your links, settings and clicks as JSON |
| `DELETE` | `/api/account` | Delete all your links, clicks and API keys |
| `GET` | `/health`, `/health/ready` | Liveness, and readiness (checks the database) |

## Deploying

- **Backend (Render):** build with `npm install && npx prisma generate && npm run build && npx prisma migrate deploy`, start with `npm start`. Set `ANALYTICS_SALT` to a long random secret (keeps unique-visitor counts stable across restarts) and `RATE_LIMIT_TRUST_PROXY=1` behind Render's proxy, and point the health check at `/health`.
- **Frontend (Vercel):** `frontend/vercel.json` proxies `/api/*` and short codes to the Render backend, so short links live on the frontend domain.
