# R2 WebDAV X

Cloudflare R2-backed WebDAV, CalDAV, and browser file management. The Worker owns DAV plus file, calendar, and session APIs; same-origin Pages Functions own Notes CRUD.

This release uses a fixed `default` user. KV-backed users, tenant isolation, billing, ACLs, and multipart uploads are intentionally not included.

## Workspace

```text
apps/
  dav-worker/       WebDAV + CalDAV + JSON API Worker
  web/              Cloudflare Pages SPA + Notes Functions
packages/
  shared-types/     API contracts shared by Worker and UI
```

R2 keys are isolated by workload:

```text
fs/default/...                              WebDAV files
caldav/default/calendars/{calendarId}/...   Calendar metadata and .ics files
```

WebDAV clients still see `/`; the internal `fs/default` prefix is never exposed in DAV hrefs.

## Local development

Requirements: Node.js 20 or newer and an R2 bucket for production deployment.

```bash
npm install
```

Create `apps/dav-worker/.dev.vars`:

```dotenv
USERNAME=admin
PASSWORD=change-me
```

Run the Worker and Vite UI in separate terminals:

```bash
npm run dev
npm run dev:web
```

The default local URLs are `http://localhost:8787` for DAV/API and `http://localhost:5173` for the UI. Set `VITE_API_BASE` in `apps/web/.env.local` when the Worker uses a different origin. Vite does not execute Pages Functions; use `wrangler pages dev dist` from `apps/web` when testing the Notes API locally.

## Configuration

Configure the R2 bucket name in `apps/dav-worker/wrangler.toml`. Set secrets with Wrangler:

```bash
cd apps/dav-worker
npx wrangler secret put USERNAME
npx wrangler secret put PASSWORD
```

Worker variables:

| Variable      | Required   | Purpose                             |
| ------------- | ---------- | ----------------------------------- |
| `USERNAME`    | yes        | Fixed single-user login             |
| `PASSWORD`    | yes        | Basic and browser login password    |
| `CORS_ORIGIN` | production | Comma-separated exact Pages origins |

Bind the same D1 database as `NOTES_DB` in both `apps/dav-worker/wrangler.toml` and `apps/web/wrangler.toml`. Session tokens expire after 30 days of inactivity; `JWT_SECRET` is only retained for compatibility with older deployments.

Set `VITE_API_BASE=https://dav.example.com` for the Pages production build. Do not use `*` for credentialed CORS.

## Endpoints

- WebDAV: `https://dav.example.com/`
- CalDAV discovery: `https://dav.example.com/.well-known/caldav`
- CalDAV home: `https://dav.example.com/caldav/default/calendars/`
- JSON API: `https://dav.example.com/api/v1/`
- Pages Notes API: `https://app.example.com/api/v1/notes`
- Pages SPA: `/login`, `/files`, `/calendar`, `/notes`, `/settings`

WebDAV and CalDAV accept Basic credentials or a random Bearer session token. Browser API routes accept the session through an HttpOnly cookie or `Authorization: Bearer` header. Worker and Pages must bind the same `NOTES_DB` so Pages Functions can validate sessions.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

Worker integration tests run in the Cloudflare Workers test pool with an isolated R2 binding. CI additionally runs the WebDAV `basic`, `copymove`, `props`, and `locks` Litmus suites.

## Deployment

```bash
npm run deploy:worker
npm run build -w @r2-webdav/web
npm run deploy:web
```

Bind the Worker to the DAV domain and Pages to the app domain. Deploy Pages from `apps/web` so Wrangler includes both `dist` and `functions`; the Pages `_redirects` file provides SPA route fallback.

## Existing bucket migration

The original project stored WebDAV objects at the bucket root. Before switching an existing deployment, copy those objects under `fs/default/` while preserving HTTP and custom metadata. Do not move CalDAV or system objects into this prefix. Test the migrated bucket with a staging Worker before changing the production route.

The Worker creates the `fs/default` root collection and the default calendar lazily on the first authenticated request. It does not automatically move legacy objects because an automatic bulk move would be destructive and difficult to roll back.
