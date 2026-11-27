# Deploying to Vercel

Sariel deploys as **one Vercel project**. The site and the API share one domain:

- The React app (`client/`) is served as static files.
- Every `/api/*` request is rewritten to one serverless function, [`client/api/index.mjs`](../client/api/index.mjs). That function runs the whole API from `api/dist`.

Because everything is on one domain:

- No CORS is needed.
- The HttpOnly sign-in cookie stays first-party.
- The `Host` header still selects organisation workspaces.

## 1. Create the project

1. In Vercel, choose **Add New → Project** and import `jomobrain1/sariel-app`.
2. Set **Root Directory** to `client` or `api`. Both work: `client/vercel.json` and `api/vercel.json` build the same site and API (with `api`, the built client is copied to `api/public`). Keep **Include files outside the root directory** turned on (the default).
3. Leave the framework, build and install settings alone. They come from [`client/vercel.json`](../client/vercel.json):
   - install: `npm ci` at the repo root
   - build: `npm run build`, which builds the API and the client
   - output: `client/dist`
4. Leave Node.js on 22.x or 24.x. The root `package.json` requires one of these.

## 2. Environment variables (Project → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Production Atlas connection string. In Atlas → Network Access, allow `0.0.0.0/0`, because Vercel has no fixed IPs. |
| `AUTH_ACCESS_SECRET`, `AUTH_REFRESH_SECRET` | Two **different** random values, each at least 32 bytes. Generate each with `openssl rand -hex 32`. |
| `AUTH_COOKIE_SESSION` | `true` |
| `SARIEL_DATA_KEY` | 64 hex characters (`openssl rand -hex 32`). This key encrypts stored provider keys. Set it once and never change it. |
| `TENANCY_BASE_DOMAIN` | The domain the site is served on, for example `sariel.vercel.app`. Later, use your own domain. |
| `APP_URL` | The full site URL, for example `https://sariel.vercel.app`. Used in emails. |
| `CRON_SECRET` | A random value. It protects `/api/cron/jobs` (see step 3). |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM_NAME` | SMTP. Use the same values as `api/.env`. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET_KEY` | Cloudinary, for photos and videos in public reports. |
| `MOBILESASA_TOKEN`, `MOBILESASA_SENDER_ID` | SMS. |
| `GEMINI_API_KEY` | Optional. Keys can also be entered by the superadmin under Settings → AI providers. |

`NODE_ENV=production` is set by Vercel automatically, which makes the cookie `Secure`.

## 3. Background jobs

A serverless function doesn't keep running between requests. So notification delivery (email and SMS) and missed check-in monitoring run whenever something calls:

```
GET https://<your-domain>/api/cron/jobs
Authorization: Bearer <CRON_SECRET>
```

Schedule that call **every minute**:

- **Vercel Pro:** add this to `client/vercel.json`, then redeploy. Vercel sends the `CRON_SECRET` header itself.
  ```json
  "crons": [{ "path": "/api/cron/jobs", "schedule": "* * * * *" }]
  ```
- **Vercel Hobby:** Hobby cron runs at most once a day, so use a free external scheduler such as cron-job.org. Have it call the URL above every minute with the `Authorization` header.

A successful call returns `{"success":true,"data":[{"name":"notification-delivery","ok":true},{"name":"welfare-monitoring","ok":true}]}`.

## 4. First superadmin

The production database starts empty. To create the superadmin:

1. Put the production `MONGODB_URI` and the `TENANCY_SUPERADMIN_*` values in a **temporary** `api/.env`.
2. Run `npm run tenancy:setup`.
3. Restore your development `.env`.

## 5. Local development against the deployed API

```bash
cp client/.env.example client/.env.local   # set API_PROXY_TARGET to your Vercel URL
npm run dev:client                         # http://localhost:5173, using the deployed API and database
```

To work on the API itself, set `API_PROXY_TARGET=http://127.0.0.1:9149`, or delete `.env.local`. Then run `npm run dev` as before.

> Working against the deployed API means you are using **production data**. Use test accounts.

## Limits to know

- **Request body: 4.5 MB on Vercel.** These features send images through the API, so photos larger than about 3 MB will fail on Vercel until they are resized in the browser or uploaded straight to Cloudinary:
  - photo check (accepts up to 6 MB)
  - report photos
  - cover images

  Public report photos and videos already upload straight to Cloudinary, so they are not affected.
- **Organisation workspaces (`org.<domain>`)** need your own domain with a wildcard (`*.yourdomain.com`) added in Vercel. `*.vercel.app` subdomains can't be used.
- **Rate limits** are kept per function instance, so they're looser than on a single server.
