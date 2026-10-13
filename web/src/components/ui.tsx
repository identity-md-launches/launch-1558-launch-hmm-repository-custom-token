import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useConfig } from '../data/app'
import { explorerAddress } from '../config'
import { shortAddress } from '../lib/format'
import type { QuestionStatus } from '../data/indexer'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/* ───────────── magnetic pull (fine pointers only) ───────────── */

/** Pulls an element a few pixels toward the pointer while it hovers, springing back on leave. */
export function useMagnetic<T extends HTMLElement>(ref: React.RefObject<T | null>, enabled = true, strength = 0.28, max = 8) {
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el || prefersReducedMotion() || !window.matchMedia?.('(pointer: fine)').matches) return
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const dx = Math.max(-max, Math.min(max, (e.clientX - (r.left + r.width / 2)) * strength))
        const dy = Math.max(-max, Math.min(max, (e.clientY - (r.top + r.height / 2)) * strength * 1.2))
        el.style.setProperty('--mx', `${dx.toFixed(2)}px`)
        el.style.setProperty('--my', `${dy.toFixed(2)}px`)
        el.classList.add('magnet-on')
      })
    }
    const leave = () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--mx', '0px')
      el.style.setProperty('--my', '0px')
      el.classList.remove('magnet-on')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [ref, enabled, strength, max])
}

/* ───────────── Button: ripple on press, spinner when busy ───────────── */

type Variant = 'primary' | 'gold' | 'lilac' | 'ghost' | 'danger' | 'default'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  busy?: boolean
  shine?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', busy, shine, className, children, onPointerDown, disabled, ...rest },
  ref,
) {
  const own = useRef<HTMLButtonElement | null>(null)
  const magnetic = variant === 'primary' || variant === 'gold' || variant === 'lilac'
  useMagnetic(own, magnetic)
  const setRef = (node: HTMLButtonElement | null) => {
    own.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  const spawn = (e: React.PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(e)
    if (prefersReducedMotion()) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const d = Math.max(rect.width, rect.height) * 2.2
    const span = document.createElement('span')
    span.className = 'ripple'
    span.style.width = span.style.height = `${d}px`
    span.style.left = `${e.clientX - rect.left - d / 2}px`
    span.style.top = `${e.clientY - rect.top - d / 2}px`
    el.appendChild(span)
    span.addEventListener('animationend', () => span.remove())
  }
  return (
    <button
      ref={setRef}
      className={[
        'btn',
        magnetic && 'magnetic',
        variant !== 'default' && `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        shine && !disabled && 'btn-shine',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={spawn}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
})

export function ButtonLink({
  to,
  variant = 'default',
  size = 'md',
  children,
  className,
}: {
  to: string
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
}) {
  const own = useRef<HTMLAnchorElement | null>(null)
  const magnetic = variant === 'primary' || variant === 'gold' || variant === 'lilac'
  useMagnetic(own, magnetic)
  return (
    <Link
      ref={own}
      to={to}
      className={['btn', magnetic && 'magnetic', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Link>
  )
}

/* ───────────── AnimatedNumber: tweens to new values ───────────── */

export function AnimatedNumber({
  value,
  format,
  exact,
  duration = 900,
  className,
}: {
  value: number | null | undefined
  format: (n: number) => string
  /** The exact text to settle on once the tween ends (e.g. a bigint formatted without float rounding). */
  exact?: string
  duration?: number
  className?: string
}) {
  const [shown, setShown] = useState<number | null>(value ?? null)
  const from = useRef<number | null>(value ?? null)
  const raf = useRef(0)
  const [bump, setBump] = useState(false)
  useEffect(() => {
    if (value === null || value === undefined) {
      setShown(null)
      from.current = null
      return
    }
    const start = from.current
    if (start === null || prefersReducedMotion() || start === value) {
      from.current = value
      setShown(value)
      return
    }
    const t0 = performance.now()
    cancelAnimationFrame(raf.current)
    setBump(true)
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration)
      const e = 1 - Math.pow(1 - k, 4)
      const v = start + (value - start) * e
      setShown(v)
      from.current = v
      if (k < 1) raf.current = requestAnimationFrame(step)
      else {
        from.current = value
        setBump(false)
      }
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])
  if (shown === null) return <span className={['skeleton', 'num-skeleton', className].filter(Boolean).join(' ')} aria-busy="true" />
  const text = !bump && exact !== undefined && shown === value ? exact : format(shown)
  return <span className={['num', bump && 'num-bump', className].filter(Boolean).join(' ')}>{text}</span>
}

/* ───────────── Reveal: fade/slide in when scrolled into view ───────────── */

export function Reveal({
  children,
  as: Tag = 'div',
  index = 0,
  className,
  style,
}: {
  children: ReactNode
  as?: 'div' | 'section' | 'li' | 'article'
  index?: number
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reduced motion, old browsers and automated captures (full-page screenshots never scroll) see everything.
    const automated = typeof navigator !== 'undefined' && (navigator as Navigator & { webdriver?: boolean }).webdriver
    if (prefersReducedMotion() || automated || !('IntersectionObserver' in window)) {
      setInView(true)
      return
    }
    const onPrint = () => setInView(true)
    window.addEventListener('beforeprint', onPrint)
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      window.removeEventListener('beforeprint', onPrint)
    }
  }, [])
  const El = Tag as 'div'
  return (
    <El
      ref={ref as React.Ref<HTMLDivElement>}
      className={['reveal', inView && 'in', className].filter(Boolean).join(' ')}
      style={{ ...style, ['--i' as string]: index }}
    >
      {children}
    </El>
  )
}

/* ───────────── address with copy + explorer link ───────────── */

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked */
    }
  }, [text])
  return (
    <button
      type="button"
      className={['copy-btn', copied && 'copied'].filter(Boolean).join(' ')}
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5" y="5" width="8.5" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 10.5V4a1.5 1.5 0 011.5-1.5H10" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </button>
  )
}

export function Addr({ address, full, you }: { address: string; full?: boolean; you?: boolean }) {
  const cfg = useConfig()
  const link = explorerAddress(cfg, address)
  const text = full ? address : shortAddress(address)
  return (
    <span className="addr">
      {link ? (
        <a href={link} target="_blank" rel="noreferrer noopener" title={address}>
          {text}
        </a>
      ) : (
        <span title={address}>{text}</span>
      )}
      {you && <span className="pill pill-frog" style={{ padding: '0 7px', fontSize: '0.68rem' }}>you</span>}
      <CopyButton text={address} label="Copy address" />
    </span>
  )
}

/* ───────────── status pill ───────────── */

const STATUS_LABEL: Record<QuestionStatus, string> = {
  open: 'raising',
  asked: 'thinking',
  answered: 'answered',
  failed: 'mist',
}

export function StatusPill({ status, label }: { status: QuestionStatus; label?: string }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" aria-hidden="true" />
      {label ?? STATUS_LABEL[status]}
    </span>
  )
}

export function Progress({ value, tone }: { value: number; tone?: 'gold' | 'frog' }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={['progress', tone].filter(Boolean).join(' ')} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Notice({
  tone,
  icon = '!',
  children,
}: {
  tone?: 'coral' | 'lilac' | 'frog'
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={['notice', tone].filter(Boolean).join(' ')}>
      <span className="notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  )
}

export function Skeleton({ w = '100%', h = 16 }: { w?: number | string; h?: number }) {
  return <span className="skeleton" style={{ display: 'block', width: w, height: h }} />
}

/* ───────────── modal ───────────── */

export function Modal({
  open,
  onClose,
  title,
  wide,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => box.current?.querySelector<HTMLElement>('button, a, input, select, textarea')?.focus(), 40)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={['modal', wide && 'modal-wide'].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.35rem' }}>{title}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
