import mongoose from 'mongoose';

// Background jobs run inside the API process. Each job claims its own records with leases,
// so several API instances can run them at once without doing the same work twice.
interface Job { name:string; everyMs:number; run:(now:Date) => Promise<unknown>; running:boolean }
const jobs: Job[] = [];
let started = false;

export function registerJob(name:string, everyMs:number, run:(now:Date) => Promise<unknown>) {
  const job:Job = {name, everyMs, run, running:false};
  jobs.push(job);
  if (started) schedule(job);
}

function schedule(job:Job) {
  const tick = async () => {
    if (job.running || mongoose.connection.readyState !== 1) return;
    job.running = true;
    try { await job.run(new Date()); }
    catch (error) { console.error(`Background job "${job.name}" failed:`, error instanceof Error ? error.message : error); }
    finally { job.running = false; }
  };
  setInterval(() => void tick(), job.everyMs).unref();
}

/** Starts every registered job unless SARIEL_WORKERS=off (used by tests, which run cycles directly). */
export function startWorkers() {
  if (started || process.env.SARIEL_WORKERS === 'off') return;
  started = true;
  jobs.forEach(schedule);
}

/**
 * Runs one cycle of every job and waits for them. For hosts where the process doesn't stay alive
 * between requests (serverless, e.g. Vercel): a scheduler calls this instead of relying on timers.
 */
export async function runJobsOnce(now = new Date()) {
  const results:{name:string; ok:boolean; error?:string}[] = [];
  for (const job of jobs) {
    if (job.running) { results.push({name:job.name, ok:true}); continue; }
    job.running = true;
    try { await job.run(now); results.push({name:job.name, ok:true}); }
    catch (error) { results.push({name:job.name, ok:false, error:error instanceof Error ? error.message : String(error)}); }
    finally { job.running = false; }
  }
  return results;
}
