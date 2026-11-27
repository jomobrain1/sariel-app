import './toaster.css'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast, toastStore, type Toast } from '../lib/toast'

const empty: readonly Toast[] = []
// Errors stay longer so there's time to read them.
const lifetime = (kind: Toast['kind']) => (kind === 'error' ? 7000 : kind === 'warning' ? 6000 : 4000)
const icons: Record<Toast['kind'], string> = {
  success: 'm8 12.5 2.8 2.8L16.5 9',
  error: 'm9 9 6 6m0-6-6 6',
  warning: 'M12 8v5m0 3.5h.01',
  info: 'M12 11v5m0-8.5h.01',
}

function ToastItem({ item }: { item: Toast }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => toast.dismiss(item.id), lifetime(item.kind))
    return () => clearTimeout(timer)
  }, [item, paused])
  return <div className={`app-toast app-toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <span className="app-toast-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={icons[item.kind]} /></svg>
    </span>
    <div className="app-toast-text">
      {item.title && <strong>{item.title}</strong>}
      <p>{item.message}</p>
    </div>
    <button type="button" aria-label="Dismiss" onClick={() => toast.dismiss(item.id)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
    {!paused && <span className="app-toast-timer" style={{ animationDuration: lifetime(item.kind) + 'ms' }} aria-hidden="true" />}
  </div>
}

/** Mounted once at the app root, so toasts show on every page (site, dashboard and admin). */
export function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => empty)
  return <section className="app-toaster" aria-label="Notifications" aria-live="polite">
    {items.map(item => <ToastItem key={item.id} item={item} />)}
  </section>
}
