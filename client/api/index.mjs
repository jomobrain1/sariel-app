// Vercel serverless entry for the Sariel API. vercel.json rewrites every /api/* request here,
// so the site and the API share one domain (no CORS; the HttpOnly refresh cookie stays first-party,
// and the Host header still selects organisation workspaces).
import { connectMongo } from '@tilcayo/core';

// Timers don't survive between serverless invocations, so background jobs run through /api/cron/jobs instead.
process.env.SARIEL_WORKERS = 'off';

const { config } = await import('../../api/dist/config.js');
const { default: app } = await import('../../api/dist/app.js');
const { runJobsOnce } = await import('../../api/dist/jobs/worker.js');

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
  if (req.url?.split('?')[0] === '/api/cron/jobs') return cron(req, res);
  return handler(req, res);
}
