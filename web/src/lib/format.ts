/** Number, amount and time formatting. Amounts are bigint base units and never pass through floats when exactness
 * matters (only the compact form, which is approximate by design, uses Number). */

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * Formats `value` base units with `decimals` as a decimal string with thousands separators.
 * Fraction digits are cut (rounded toward zero) to `maxFrac` and trailing zeros trimmed down to `minFrac`.
 */
export function formatUnitsFixed(
  value: bigint,
  decimals = 18,
  { maxFrac = 4, minFrac = 0 }: { maxFrac?: number; minFrac?: number } = {},
): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  let frac = (abs % base).toString().padStart(decimals, '0').slice(0, Math.max(0, maxFrac))
  frac = frac.replace(/0+$/, '')
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0')
  const tiny = whole === 0n && frac.replace(/0/g, '') === '' && abs !== 0n
  if (tiny) {
    // Non-zero but below the shown precision: say so instead of printing 0.
    return `${negative ? '>-' : '<'}0.${'0'.repeat(Math.max(0, maxFrac - 1))}1`
  }
  return `${negative ? '-' : ''}${group(whole.toString())}${frac ? `.${frac}` : ''}`
}

const COMPACT = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'k' },
]

/** 1234 → "1.23k", 650000000 → "650M". Approximate by design. */
export function compactNumber(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '–'
  const abs = Math.abs(n)
  for (const { v, s } of COMPACT) {
    if (abs >= v) {
      const x = n / v
      return `${trimZeros(x.toPrecision(digits))}${s}`
    }
  }
  if (abs >= 1 || abs === 0) return trimZeros(n.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2))
  return trimZeros(n.toPrecision(2))
}

function trimZeros(s: string): string {
  return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s
}

/** Base units → Number (approximate; for charts, animation and compact display only). */
export function toNumber(value: bigint, decimals = 18): number {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = value % base
  return Number(whole) + Number(frac) / Number(base)
}

/** HMM amounts: exact with 2 decimals below a million, compact above. */
export function formatHmm(value: bigint, { compact = true }: { compact?: boolean } = {}): string {
  if (compact && (value >= 10n ** 24n || value <= -(10n ** 24n))) return compactNumber(toNumber(value))
  return formatUnitsFixed(value, 18, { maxFrac: 2 })
}

/** IMD amounts: up to 4 decimals. */
export function formatImd(value: bigint): string {
  return formatUnitsFixed(value, 18, { maxFrac: 4 })
}

export function formatInt(n: number | bigint): string {
  if (typeof n === 'bigint') return (n < 0n ? '-' : '') + group((n < 0n ? -n : n).toString())
  if (!Number.isFinite(n)) return '–'
  return (n < 0 ? '-' : '') + group(Math.floor(Math.abs(n)).toString())
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '–'
  const p = fraction * 100
  if (p !== 0 && Math.abs(p) < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}%`
  return `${trimZeros(p.toFixed(digits))}%`
}

/** Parses a user-typed decimal amount into base units. Returns null when it is not a valid non-negative amount. */
export function parseAmount(input: string, decimals = 18): bigint | null {
  const s = input.trim().replace(/,/g, '')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const [whole = '0', frac = ''] = s.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac || '').padEnd(decimals, '0') || '0')
}

/** Seconds → "4m 12s", "2h 05m", "179d 3h". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '–'
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Seconds → "09:59" (or "1:02:03" past an hour), for ticking countdowns. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Seconds since → "12s ago", "5m ago", "3h ago", "2d ago". */
export function formatAgo(secondsAgo: number): string {
  const s = Math.max(0, Math.floor(secondsAgo))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 → 0xf39F…2266 */
export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < 2 + chars * 2) return address
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`
}

export function shortHex(hex: string, chars = 6): string {
  if (!hex || hex.length <= 2 + chars * 2) return hex
  return `${hex.slice(0, 2 + chars)}…${hex.slice(-chars)}`
}

export function plural(n: number | bigint, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 || n === 1n ? one : many}`
}

/** Float HMM for tweening displays (compact from a million). */
export function formatHmmFloat(n: number): string {
  if (!Number.isFinite(n)) return '–'
  return Math.abs(n) >= 1e6 ? compactNumber(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Float IMD for tweening displays. */
export function formatImdFloat(n: number): string {
  if (!Number.isFinite(n)) return '–'
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
}
