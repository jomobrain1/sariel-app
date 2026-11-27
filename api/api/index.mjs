// Vercel serverless entry for the Sariel API (used with Root Directory `api` or `client`). vercel.json rewrites every /api/* request here,
// so the site and the API share one domain (no CORS; the HttpOnly refresh cookie stays first-party,
// and the Host header still selects organisation workspaces).
import { connectMongo } from '@tilcayo/core';

// Timers don't survive between serverless invocations, so background jobs run through /api/cron/jobs instead.
process.env.SARIEL_WORKERS = 'off';

// Tenancy treats a request as the main site only when its host equals TENANCY_BASE_DOMAIN exactly.
// Accept values pasted as URLs ("https://x.vercel.app/") and fall back to the project's production domain.
// Local values copied from api/.env (localhost) never match on Vercel, so they are ignored there.
const local = value => !value || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(value);
const host = value => value?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '') || undefined;
const configured = host(process.env.TENANCY_BASE_DOMAIN);
const domain = process.env.VERCEL && local(configured) ? host(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? configured : configured;
if (domain) process.env.TENANCY_BASE_DOMAIN = domain;
if (domain && (!process.env.APP_URL || local(host(process.env.APP_URL)))) process.env.APP_URL = `https://${domain}`;

const { config } = await import('../dist/config.js');
const { default: app } = await import('../dist/app.js');
const { runJobsOnce } = await import('../dist/jobs/worker.js');

// Tilcayo only exposes listen(); take its Express request handler from a throwaway server.
const probe = app.listen(0);
const handler = probe.listeners('request')[0];
probe.close();
// Vercel sets X-Forwarded-For itself, so the client IP (used by rate limits) can be trusted.
handler.set('trust proxy', true);

let connecting;
const connected = () => (connecting ??= connectMongo(config.mongoUri).catch(error => { connecting = undefined; throw error; }));

// Called by Vercel Cron (GET with "Authorization: Bearer $CRON_SECRET") or any external scheduler.
async function cron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
  }
  const results = await runJobsOnce();
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: results.every(r => r.ok), data: results }));
}

export default async function sariel(req, res) {
  try { await connected(); }
  catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ success: false, message: 'Database unavailable. Check MONGODB_URI and Atlas network access.' }));
  }
  // Shows which domain tenancy expects, so a mismatched TENANCY_BASE_DOMAIN is easy to spot.
  res.setHeader('X-Sariel-Base-Domain', process.env.TENANCY_BASE_DOMAIN ?? '');
  // Every *.vercel.app address (renamed projects, aliases, previews) is the main site: workspaces need a custom domain.
  const requestHost = host(req.headers.host);
  if (process.env.VERCEL && domain && requestHost?.endsWith('.vercel.app')) req.headers.host = domain;
  if (req.url?.split('?')[0] === '/api/cron/jobs') return cron(req, res);
  return handler(req, res);
}
