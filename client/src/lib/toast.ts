export type ToastKind = 'success' | 'error' | 'warning' | 'info'
export type Toast = { id: number; message: string; kind: ToastKind; title?: string }

// Several toasts can show at once (newest first); each closes on its own timer.
let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

function show(kind: ToastKind, message: string, title?: string) {
  const id = nextId++
  toasts = [{ id, kind, message, ...(title ? { title } : {}) }, ...toasts].slice(0, 4)
  emit()
  return id
}

export const toast = {
  success: (message: string, title?: string) => show('success', message, title),
  error: (message: string, title?: string) => show('error', message, title),
  warning: (message: string, title?: string) => show('warning', message, title),
  info: (message: string, title?: string) => show('info', message, title),
  /** Closes one toast, or all of them without an id. */
  dismiss: (id?: number) => { toasts = id === undefined ? [] : toasts.filter(t => t.id !== id); emit() },
}

export const toastStore = {
  getSnapshot: () => toasts,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
