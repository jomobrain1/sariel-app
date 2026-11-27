# Prompt: set up email and SMS delivery jobs on a VPS

Copy everything below the line into Codex when the app moves to a VPS.

---

You are deploying the Sariel app (an npm workspaces monorepo: `api/` and `client/`) to a Linux VPS. Your task is to make sure queued **email and SMS notifications are actually sent**, on a schedule, once the app runs on the VPS. Keep the setup simple; we will tune intervals and providers later.

## How notifications work today

- When something happens (a danger report, a circle invite, a missed check-in), the API stores a notification and queues one row per channel in the MongoDB collection `sariel_notification_deliveries`, with `state: 'queued'`.
- Background jobs send them. They are registered in the API code:
  - `notification-delivery`: sends queued email and SMS. Registered with `registerJob('notification-delivery', 15_000, …)`; look in `api/src/notifications/engine.ts`.
  - `welfare-monitoring`: missed scheduled check-ins. Runs every 60 s; look in `api/src/welfare/welfare.ts`.
- `api/src/jobs/worker.ts` has two ways to run them:
  - `startWorkers()`: in-process timers. `api/src/app.ts` calls it on startup unless `SARIEL_WORKERS=off`.
  - `runJobsOnce()`: runs one cycle of every job and returns `[{ name, ok, error? }]`.
- On Vercel (serverless) timers don't survive, so `api/api/index.mjs` sets `SARIEL_WORKERS=off` and exposes `GET /api/cron/jobs`. It requires `Authorization: Bearer $CRON_SECRET` and calls `runJobsOnce()`. **That route exists only in the Vercel entry, not in `api/src/app.ts`.**

## What to do on the VPS

1. **Run the API as a long-lived process.** Run `npm ci && npm run build` at the repo root, then `npm run start --workspace api` under **systemd** (or pm2) with restart on failure. On a VPS the in-process timers work, so jobs run on their own while the process is up. Do **not** set `SARIEL_WORKERS=off` on the VPS API process.

2. **Add a cron safety net that sends email and SMS every minute**, even if the timers stall:
   - Create `api/src/scripts/run-jobs.ts`. It loads config, connects to Mongo with `connectMongo(config.mongoUri)` from `@tilcayo/core` (see how `api/src/index.ts` and `api/src/config.ts` start the app), imports `./app.js` so all jobs register, sets `SARIEL_WORKERS=off` **before** importing so it doesn't start timers, calls `runJobsOnce()`, prints the JSON results, disconnects, and exits non-zero if any job has `ok: false`.
   - Add a script to `api/package.json`: `"jobs:run": "node --env-file-if-exists=.env dist/scripts/run-jobs.js"`.
   - Add a crontab entry for the app user (adjust paths):
     ```
     * * * * * cd /srv/sariel-app/api && /usr/bin/flock -n /tmp/sariel-jobs.lock npm run jobs:run >> /var/log/sariel-jobs.log 2>&1
     ```
     `flock` prevents overlapping runs. The jobs claim rows with leases, so running alongside the in-process timers is safe.

3. **Environment variables** in `api/.env` on the VPS. Never commit this file.
   - Email (Gmail SMTP): `MAIL_HOST=smtp.gmail.com`, `MAIL_PORT=465`, `MAIL_USER`, `MAIL_PASS` (a Gmail app password), `MAIL_FROM_NAME`.
   - SMS (Mobile Sasa): `MOBILESASA_TOKEN`, `MOBILESASA_SENDER_ID`.
   - Plus the rest the API needs: `MONGODB_URI`, `AUTH_ACCESS_SECRET`, `AUTH_REFRESH_SECRET`, `AUTH_COOKIE_SESSION=true`, `SARIEL_DATA_KEY` (must be the **same** value as every other environment using this database), `TENANCY_BASE_DOMAIN`, `APP_URL`, `CLOUDINARY_*`, `GEMINI_API_KEY` (optional).

4. **Make sure only one environment sends.** If the old Vercel deployment or a developer laptop still points at the same database, their workers will also pick up queued deliveries. Either point them at a different database, or set `SARIEL_WORKERS=off` there and remove their cron.

## How to verify

- Run `npm run jobs:run` by hand. It should print `notification-delivery` and `welfare-monitoring` with `ok: true`.
- Trigger a test alert, for example a danger report from a test account that has a circle member with an email and phone number. Within about a minute, check `sariel_notification_deliveries`: the new rows should go from `queued` to `sent`.
- If rows show `state: 'skipped'`, read `lastError`. "Email is not configured" means `MAIL_USER`/`MAIL_PASS` are missing in that process's environment. "SMS is not configured" means `MOBILESASA_TOKEN` is missing.
- Check `/var/log/sariel-jobs.log` for cron output.

Keep the change minimal and don't alter notification wording or the job logic itself.
