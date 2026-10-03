# Purpio

Describe it. See it. Ship it. An AI studio where anyone turns one sentence into a finished website, web app, mobile app, image or video — with live preview, visible thinking, source code, one-click deploy to a Purpio subdomain or their own Hostinger, in-site PayPal/Google Pay billing, and a credit system priced at 2× your provider cost.

## What's in the box

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 15 app: home, builder (live WebSocket build stream + preview + Monaco files + versions + media + deploy), pricing, in-site checkout (PayPal Advanced Card Fields, Vault, Google Pay, PayPal), 13 settings pages, admin console |
| `apps/api` | Fastify API: Firebase auth → session cookie, credits ledger with holds, projects/chat/media/deploy, PayPal orders/vault/subscriptions/webhooks, invoices (PDF), encrypted secrets, API keys, team, admin |
| `apps/worker` | BullMQ workers: the 4-stage build pipeline (intent → design → build → review), preview builder, Gemini image/video, deploy (subdomain, Hostinger API+SSH, zip, GitHub), emails, hourly billing (renewals, dunning, reminders, credit expiry) |
| `packages/db` | Prisma schema (30 tables) + seed (models with prices, plans, packs, 20 idea cards, 8 templates, LAUNCH30 coupon) |
| `packages/prompts` | The background master prompts, the 15-point "complete product" checklist, file parser, style seed |
| `packages/email` | 19 React Email templates sent through Resend |
| `packages/shared` | Zod schemas and types shared by web, api and worker |

## Run it

```bash
corepack enable && pnpm install
cp .env.example .env            # fill in keys (see below)
docker compose up -d postgres redis
pnpm --filter @purpio/db generate
pnpm --filter @purpio/db migrate:dev --name init
pnpm db:seed
pnpm dev                        # web :3000, api :4000, worker
```

Make yourself admin after first sign-in: `UPDATE "User" SET role='admin' WHERE email='you@…';` then enable 2FA in Settings → Security (admin routes require it).

## Keys you need

| Service | Where | Used for |
| --- | --- | --- |
| Firebase | console.firebase.google.com → Project settings → Service accounts, plus Web app config | Email/Google/GitHub sign-in |
| OpenAI | platform.openai.com | GPT-5 and GPT-5 mini (code, briefs, review) |
| Anthropic | console.anthropic.com | Claude Sonnet 4.6 (Pro plan model) |
| Google AI | aistudio.google.com | Gemini Flash, Gemini Image, Veo video |
| PayPal | developer.paypal.com → app with Advanced Checkout + Vault + Subscriptions; add a webhook to `https://api.yourdomain/billing/webhooks/paypal` for `PAYMENT.CAPTURE.*` and `BILLING.SUBSCRIPTION.*` | All payments, saved cards, renewals |
| Resend | resend.com, verify your domain | Every email |
| S3 / R2 | AWS S3 or Cloudflare R2 bucket + a CDN hostname | Previews, media, invoices, exports |
| Cloudflare | API token with DNS edit on your zone | `name.purpio.app` subdomains |
| MASTER_KEY | `openssl rand -base64 32` | Envelope encryption of user secrets (swap `wrapKey` in `apps/api/src/lib/crypto.ts` for KMS in production) |

## How money works

1 credit = $0.01 to the user. Every model's credits are `provider cost × markup (2) × 100`, computed from the `Model` table — change a cost in Admin → Models and every estimate updates. Plans: Free 150 one-time, Starter $19 / 1,500, Pro $49 / 4,500, Studio $129 / 14,000. Packs: $10/800, $25/2,200 (+10%), $50/4,800 (+20%), $100/10,000 (+25%).

Before any model call the API places a **hold**; the worker **settles** it to the exact token count or **releases** it on failure, so a failed build never charges. At 0 available credits the API returns `402 { topup: true }` and the UI opens the top-up sheet (one tap on the saved card).

## Deploy Purpio itself

- Web → Vercel (set `NEXT_PUBLIC_*` vars). API + worker → `docker compose` on a Hostinger VPS, Railway or Fly. Postgres → Neon/Supabase/RDS. Redis → Upstash or the compose service.
- Point `APP_URL` and `API_URL`; the API's CORS allows only `APP_URL`.
- Set the PayPal webhook, Resend domain, and Cloudflare DNS for `*.purpio.app`.

## Where the quality comes from

`packages/prompts/src/index.ts` holds the four background prompts the user never sees. Stage 2 forces a subject-specific palette, typeface pair, hero concept and signature element and lists the generic tells to avoid; stage 3 enforces 15 hard requirements (admin area with slider manager, animated buttons, dark mode, autofill, SEO, seeded content, legal pages…); stage 4 builds the project and fixes anything that fails before the user sees it. Admin → Prompts lets you version and A/B test them without a deploy.
