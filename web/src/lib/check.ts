import type { AnswerType } from './body'

/**
 * The IMD swarm's free question validator (`POST https://api.imd.fun/requests/check`). It refuses browser origins,
 * so the app calls it through a proxy (`VITE_CHECK_URL`: the dev server's /imd-check, the preview server, or
 * proxy/check-worker.js).
 */

export interface CheckIssue {
  code: string
  detail?: string
}

export interface CheckResult {
  blockers: CheckIssue[]
  suggestions: CheckIssue[]
  online: number | null
  judged: boolean
  request: Record<string, unknown> | null
}

export interface CheckSpec {
  question: string
  answerType: AnswerType
  evidence?: 'chain' | 'panel'
  chainId?: number
  panelSize?: number
  toleranceBps?: number
}

export function checkInput(s: CheckSpec) {
  return {
    action: 'oracle.request',
    input: {
      question: s.question,
      panelSize: s.panelSize ?? 5,
      answerType: s.answerType,
      evidence: s.evidence ?? 'chain',
      chainId: s.chainId ?? 1,
      ...(s.answerType === 'uint256' ? { toleranceBps: s.toleranceBps ?? 0 } : {}),
    },
  }
}

export async function checkQuestion(url: string, spec: CheckSpec, signal?: AbortSignal): Promise<CheckResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(checkInput(spec)),
    signal,
    referrerPolicy: 'no-referrer',
  })
  if (res.status === 429) throw new Error('The checker is busy (rate limited). Try again in a minute.')
  const json = (await res.json().catch(() => null)) as {
    blockers?: CheckIssue[]
    suggestions?: CheckIssue[]
    online?: number
    judged?: boolean
    request?: Record<string, unknown>
    error?: string
    detail?: string
  } | null
  if (!res.ok || !json) throw new Error(json?.error ? `${json.error}${json.detail ? `: ${json.detail}` : ''}` : `checker error ${res.status}`)
  return {
    blockers: Array.isArray(json.blockers) ? json.blockers : [],
    suggestions: Array.isArray(json.suggestions) ? json.suggestions : [],
    online: typeof json.online === 'number' ? json.online : null,
    judged: Boolean(json.judged),
    request: json.request ?? null,
  }
}
