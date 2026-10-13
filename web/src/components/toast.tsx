import { useSyncExternalStore } from 'react'
import type { Hex } from 'viem'
import { useConfig } from '../data/app'
import { explorerTx } from '../config'
import { shortHex } from '../lib/format'

export type ToastKind = 'pending' | 'success' | 'error' | 'info' | 'mined'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  body?: string
  hash?: Hex
  ttl?: number
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  toasts = [...toasts]
  for (const fn of listeners) fn()
}

function arm(t: Toast) {
  const old = timers.get(t.id)
  if (old) clearTimeout(old)
  if (t.ttl) timers.set(t.id, setTimeout(() => toast.dismiss(t.id), t.ttl))
}

export const toast = {
  show(t: Omit<Toast, 'id'>): number {
    const item = { ...t, id: nextId++ }
    toasts = [...toasts.slice(-4), item]
    arm(item)
    emit()
    return item.id
  },
  update(id: number, patch: Partial<Omit<Toast, 'id'>>) {
    const i = toasts.findIndex((t) => t.id === id)
    if (i < 0) return
    toasts[i] = { ...toasts[i]!, ...patch }
    arm(toasts[i]!)
    emit()
  },
  dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id)
    const tm = timers.get(id)
    if (tm) clearTimeout(tm)
    timers.delete(id)
    emit()
  },
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const ICON: Record<ToastKind, string> = { pending: '', success: '✓', error: '!', info: 'i', mined: '◎' }

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  const cfg = useConfig()
  return (
    <div className="toaster" role="region" aria-label="Notifications" aria-live="polite">
      {list.map((t) => {
        const link = t.hash ? explorerTx(cfg, t.hash) : null
        return (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">
              {t.kind === 'pending' ? <span className="spinner" /> : ICON[t.kind]}
            </span>
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
              {t.hash &&
                (link ? (
                  <a href={link} target="_blank" rel="noreferrer noopener" className="mono">
                    {shortHex(t.hash)} ↗
                  </a>
                ) : (
                  <span className="mono dim">{shortHex(t.hash)}</span>
                ))}
            </div>
            <button className="toast-close" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
