import { useLocation } from 'react-router-dom'
import { useApp } from '../data/app'
import { useStats } from '../data/hooks'
import { useNow } from '../data/clock'
import { formatDuration } from '../lib/format'

/** A slim banner for states that change what the whole site can do: no mine yet, mining not open yet, sync errors. */
export function LaunchBanner() {
  const { launch, launchError, indexer } = useApp()
  const { pathname } = useLocation()
  const stats = useStats().data
  const now = useNow()
  if (pathname === '/') return null

  let text: string | null = null
  let tone = ''
  if (launch === 'discovering') text = 'Looking for the hmm mine on chain…'
  else if (launch === 'prelaunch') text = 'Mining opens soon: the hmm mine is not live yet. Everything here works except asking and claiming.'
  else if (launch === 'error')
    text = `Couldn't reach the chain to find the mine${launchError ? ` (${launchError.slice(0, 80)})` : ''}. Retrying.`
  else if (stats && stats.genesis > BigInt(now))
    text = `Mining opens in ${formatDuration(Number(stats.genesis) - now)}. Questions can be asked from genesis on.`
  else if (indexer?.state.status === 'error') {
    text = `Couldn't read the mine's history${indexer.state.error ? ` (${indexer.state.error.slice(0, 80)})` : ''}. Retrying.`
    tone = 'coral'
  }
  if (!text) return null
  return (
    <div className={['launch-banner', tone].filter(Boolean).join(' ')} role="status">
      <span className="dot" aria-hidden="true" />
      {text}
    </div>
  )
}
