# SHRT

A URL shortener with custom aliases, expiring links, QR codes and click analytics.

- **Frontend** — React 19 + Vite (`frontend/`), deployed on Vercel
- **Backend** — Express 5 + Prisma on Neon Postgres (`backend/`), deployed on Render
- **Auth** — Neon Auth (Better Auth); the API verifies bearer JWTs against the JWKS endpoint

## Features

- Shorten any HTTP(S) URL, with an optional custom alias (`/my-launch`) and live availability check
- Expiry presets (1 hour → 30 days) or a custom date; expired links show visitors a branded page
- Dashboard with totals, search, filters and sorting; edit a link's destination or expiry, or delete it
- Per-link analytics: clicks over 7/30/90 days, devices, browsers, OS, referrers, countries
- QR code for every link, downloadable as PNG
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
| `npm test -w backend` | Unit tests for URL, alias and expiry validation |
| `npm run build -w backend` | Type-check and compile the API to `backend/dist` |
| `npm run db:migrate -w backend` | Apply pending Prisma migrations (`prisma migrate deploy`) |
| `npm run build -w frontend` | Type-check and build the SPA to `frontend/dist` |
| `npm run lint -w frontend` | Lint the frontend with oxlint |

## API

All `/api/urls` routes need `Authorization: Bearer <Neon Auth JWT>`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/urls` | Your links with click stats |
| `POST` | `/api/urls` | `{ originalUrl, alias?, expiresAt? }` → `201`; `409` if the alias is taken |
| `GET` | `/api/urls/alias-availability?alias=x` | `{ available, reason? }` |
| `PATCH` | `/api/urls/:id` | Any of `{ originalUrl, expiresAt }` (`expiresAt: null` removes expiry) |
| `DELETE` | `/api/urls/:id` | `204`; also deletes the link's click history |
| `GET` | `/api/urls/:id/analytics?startDate&endDate` | Daily clicks + devices, up to 90 days |
| `GET` | `/:shortCode` | `302` to the destination; `404`/`410` as HTML for browsers, JSON otherwise |
| `GET` | `/health`, `/health/ready` | Liveness, and readiness (checks the database) |

## Deploying

- **Backend (Render):** build with `npm install && npx prisma generate && npm run build && npx prisma migrate deploy`, start with `npm start`. Set `RATE_LIMIT_TRUST_PROXY=1` behind Render's proxy, and point the health check at `/health`.
- **Frontend (Vercel):** `frontend/vercel.json` proxies `/api/*` and short codes to the Render backend, so short links live on the frontend domain.
