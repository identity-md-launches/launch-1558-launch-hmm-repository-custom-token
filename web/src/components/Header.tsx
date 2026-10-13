import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useApp } from '../data/app'
import { FrogMascot, Wordmark } from './FrogMascot'
import { WalletButton } from './Wallet'
import { SoundToggle } from '../sound/SoundToggle'

const PRIMARY = [
  { to: '/ask', label: 'Ask' },
  { to: '/open', label: 'Open questions' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/miners', label: 'Miners' },
  { to: '/moon', label: 'The moon' },
]
const MORE = [
  { to: '/how', label: 'How it works' },
  { to: '/token', label: 'Token' },
  { to: '/faq', label: 'FAQ' },
]

export function Header() {
  const { cfg } = useApp()
  const { isConnected } = useAccount()
  const { pathname } = useLocation()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const onPond = pathname === '/'

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header className={['header', (scrolled || !onPond) && 'header-solid', open && 'header-open'].filter(Boolean).join(' ')}>
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="hmm, home">
          <FrogMascot size={38} thinking={false} title="hmm" />
          <Wordmark />
        </Link>
        <nav className="nav" aria-label="Main">
          {PRIMARY.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => ['nav-link', isActive && 'active'].filter(Boolean).join(' ')}>
              {n.label}
            </NavLink>
          ))}
          <div className="nav-more">
            <button className="nav-link" aria-haspopup="true">
              More
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <div className="nav-more-menu">
              {MORE.map((n) => (
                <NavLink key={n.to} to={n.to} className="nav-more-item">
                  {n.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>
        <div className="header-right">
          {cfg.isDevnet && (
            <span className="pill pill-open net-pill" title={`chain ${cfg.chainId}`}>
              <span className="dot" />
              devnet
            </span>
          )}
          {isConnected && (
            <NavLink to="/me" className={({ isActive }) => ['nav-link', 'me-link', isActive && 'active'].filter(Boolean).join(' ')}>
              My thoughts
            </NavLink>
          )}
          <SoundToggle />
          <WalletButton />
          <button
            className="burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
      <div className="mobile-nav" aria-hidden={!open}>
        <nav aria-label="Mobile">
          {[{ to: '/', label: 'The pond' }, ...PRIMARY, { to: '/me', label: 'My thoughts' }, ...MORE].map((n, i) => (
            <NavLink key={n.to} to={n.to} style={{ ['--i' as string]: i }} tabIndex={open ? 0 : -1}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}
