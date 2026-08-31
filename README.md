# ThunderMail

ThunderMail is a disposable email MVP for `temp.thunderanticheat.app`. It creates 15-minute inboxes at `@mail.thunderanticheat.app`, polls for new messages, and displays sanitized email content without accounts or attachments.

## Stack

- React 19 + TypeScript on Vite (Vinext), deployed to Vercel through Nitro
- Tailwind CSS 4 + shadcn/ui primitives
- Cloudflare Worker with Email Routing and HTTP API handlers
- Cloudflare D1 for mailboxes and messages
- PostalMime for MIME parsing
- `sanitize-html` plus a sandboxed iframe for message rendering

## Project structure

```text
app/                    Web entry and metadata
components/             ThunderMail UI and shadcn/ui primitives
lib/                    API client and localStorage persistence
db/schema.ts            Drizzle source of truth for the D1 schema
worker/src/index.ts      HTTP, Email Routing, and cleanup Worker handlers
worker/migrations/       Generated D1 migrations
worker/wrangler.jsonc    Cloudflare Worker bindings, routes, and variables
```

## Run locally

Requirements: Node.js 22+ and pnpm.

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create the local frontend environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Apply the checked-in migration to the local D1 database:

   ```bash
   pnpm db:migrate:local
   ```

4. Start the Worker in one terminal:

   ```bash
   pnpm dev:worker
   ```

5. Start the web app in another terminal:

   ```bash
   pnpm dev:web
   ```

6. Open [http://localhost:3000](http://localhost:3000). The local API runs at `http://localhost:8787`.

The mailbox token is stored only in `localStorage` and sent as a bearer token when the browser polls the Worker. Creating a new address deletes the previous mailbox when possible.

## Production architecture

```text
temp.thunderanticheat.app       → Vercel frontend
api.thunderanticheat.app        → Cloudflare HTTP API Worker → D1
*@mail.thunderanticheat.app     → Cloudflare Email Routing → API Worker → D1
```

## Cloudflare backend setup

The repository is ready for the domain and Email Routing configuration described in the product plan. Before deploying, replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `worker/wrangler.jsonc`.

### 1. Create and migrate D1

```bash
pnpm exec wrangler d1 create thundermail-db
pnpm --dir worker db:migrate:remote
```

Copy the database ID returned by the first command into `worker/wrangler.jsonc`, then run the migration command.

When `db/schema.ts` changes later, generate a new migration with:

```bash
pnpm db:generate
```

### 2. Deploy the API and email Worker

```bash
pnpm --dir worker deploy
```

The Worker is available at `api.thunderanticheat.app`. It also exposes an `email()` handler for Cloudflare Email Routing and a five-minute scheduled cleanup for expired inboxes. The older `temp.thunderanticheat.app/api/*` route remains as a harmless transition route and can be removed after DNS points `temp` directly to Vercel.

In the Cloudflare dashboard:

1. Open Email Routing for `thunderanticheat.app`.
2. Confirm the subdomain `mail.thunderanticheat.app` has Email Routing enabled.
3. Add a catch-all rule for that mail subdomain.
4. Choose **Send to a Worker** and select `thundermail-api`.

The resulting flow is:

```text
*@mail.thunderanticheat.app → thundermail-api → D1
```

## Vercel frontend setup

The production frontend calls `https://api.thunderanticheat.app`. The local frontend continues to use `VITE_API_URL=http://localhost:8787` from `.env.local`.

### Deploy with the Vercel CLI

```bash
pnpm dlx vercel login
pnpm dlx vercel link
pnpm deploy:web
```

The first production deployment receives a `*.vercel.app` URL. Test that URL before moving the custom domain.

In the Vercel project dashboard:

1. Open **Settings → Domains** and add `temp.thunderanticheat.app`.
2. Copy the exact CNAME target Vercel provides.
3. In Cloudflare, remove `temp.thunderanticheat.app` from the old `thundermail` frontend Worker's custom domains.
4. In Cloudflare DNS, create the `temp` CNAME with Vercel's target and set it to **DNS only**.
5. Wait for Vercel to verify DNS and provision TLS.

Do not remove or modify `api.thunderanticheat.app`, `mail.thunderanticheat.app`, `thundermail-api`, Email Routing, or D1 when moving the frontend.

## Security and v1 limits

- Mailboxes expire after 15 minutes; the scheduled handler removes expired inboxes and cascades message deletion.
- The public mailbox ID is not sufficient to read mail. API reads and deletion require the random mailbox token, stored as a SHA-256 hash in D1.
- HTML is sanitized on ingestion. Scripts, forms, iframes, images, event handlers, unsafe URL schemes, and URL-bearing CSS are removed. A restricted set of presentation-only inline styles and table attributes is retained so transactional emails remain readable.
- Sanitized HTML is displayed in an iframe with `sandbox`, `no-referrer`, and a restrictive Content Security Policy.
- Attachments are not stored or displayed. Raw messages over 1 MB are rejected.
- The API disables caching and restricts CORS to the production origin plus localhost during development.

## Useful checks

```bash
pnpm build:vercel
pnpm --dir worker exec tsc -p tsconfig.json
pnpm worker:check
```

`pnpm worker:check` creates a local dry-run bundle and does not deploy anything.
