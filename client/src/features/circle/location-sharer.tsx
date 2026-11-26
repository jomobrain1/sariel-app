import { useEffect, useRef } from 'react';
import { useAuth } from '../../app/auth';
import { circleApi } from './circle.api';

type QueuedPoint = { clientId: string; latitude: number; longitude: number; accuracy: number; recordedAt: string };
const MAX_QUEUE = 100;

function readQueue(key: string): QueuedPoint[] {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as QueuedPoint[] : []; } catch { return []; }
}
function writeQueue(key: string, points: QueuedPoint[]) {
  try { if (points.length) localStorage.setItem(key, JSON.stringify(points)); else localStorage.removeItem(key); } catch { /* Memory queue still applies. */ }
}

/**
 * While location sharing is on and the app is open, records the browser's position on a fixed
 * interval and uploads it. Points that fail to send are kept and retried with the same IDs.
 */
export function LocationSharer() {
  const { user } = useAuth();
  const individual = !!user && !user.tenant && user.platformRole !== 'superadmin';
  const settings = circleApi.useLocationSettingsQuery(undefined, { skip: !individual });
  const [send] = circleApi.useSendLocationsMutation();
  const queue = useRef<QueuedPoint[]>([]);
  const sharing = settings.currentData?.data.sharing ?? false;
  const minutes = settings.currentData?.data.intervalMinutes ?? 5;
  const key = 'sariel-location-queue:' + (user?.id ?? '');

  useEffect(() => {
    if (!individual || !sharing || !('geolocation' in navigator)) return;
    let stopped = false;
    queue.current = readQueue(key);
    async function flush() {
      if (!queue.current.length || !navigator.onLine) return;
      const batch = queue.current.slice(0, MAX_QUEUE);
      try {
        await send(batch).unwrap();
        queue.current = queue.current.slice(batch.length);
      } catch { /* Keep the batch for the next attempt. */ }
      writeQueue(key, queue.current);
    }
    function capture() {
      navigator.geolocation.getCurrentPosition(position => {
        if (stopped) return;
        queue.current = [...queue.current, {
          clientId: crypto.randomUUID(), latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: Math.min(position.coords.accuracy, 100_000), recordedAt: new Date(position.timestamp).toISOString(),
        }].slice(-MAX_QUEUE);
        writeQueue(key, queue.current);
        void flush();
      }, () => { void flush(); }, { enableHighAccuracy: true, maximumAge: 60_000, timeout: 30_000 });
    }
    capture();
    const timer = setInterval(capture, minutes * 60_000);
    window.addEventListener('online', flush);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('online', flush); };
  }, [individual, sharing, minutes, key, send]);

  return null;
}
