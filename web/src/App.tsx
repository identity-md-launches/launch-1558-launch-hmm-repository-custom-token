import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { Toaster } from './components/toast'
import { LaunchBanner } from './components/LaunchBanner'
import { LiveNotifier } from './components/LiveNotifier'
import { PondPage } from './pages/PondPage'

const AskPage = lazy(() => import('./pages/AskPage'))
const OpenPage = lazy(() => import('./pages/OpenPage'))
const MePage = lazy(() => import('./pages/MePage'))
const LedgerPage = lazy(() => import('./pages/LedgerPage'))
const QuestionPage = lazy(() => import('./pages/QuestionPage'))
const MinersPage = lazy(() => import('./pages/MinersPage'))
const MoonPage = lazy(() => import('./pages/MoonPage'))
const HowPage = lazy(() => import('./pages/HowPage'))
const TokenPage = lazy(() => import('./pages/TokenPage'))
const FaqPage = lazy(() => import('./pages/FaqPage'))
const NotFound = lazy(() => import('./pages/NotFound'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

/** A soft light follows the pointer across hoverable cards (one delegated listener; fine pointers only). */
function usePointerGlow() {
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let ev: PointerEvent | null = null
    const apply = () => {
      raf = 0
      if (!ev) return
      const el = (ev.target as Element | null)?.closest?.('.card.hoverable, .tpl, .pay-mode, .connector') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--gx', `${ev.clientX - r.left}px`)
      el.style.setProperty('--gy', `${ev.clientY - r.top}px`)
    }
    const move = (e: PointerEvent) => {
      ev = e
      if (!raf) raf = requestAnimationFrame(apply)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
    }
  }, [])
}

/** Each route fades in (keyed by path) instead of snapping. */
function RouteFade({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="route-fade">
      {children}
    </div>
  )
}

function PageFallback() {
  return (
    <div className="page" aria-busy="true">
      <div className="page-head">
        <span className="skeleton" style={{ width: 120, height: 14 }} />
        <span className="skeleton" style={{ width: '60%', height: 48 }} />
      </div>
    </div>
  )
}

export function App() {
  usePointerGlow()
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <LaunchBanner />
      <main id="main">
        <RouteFade>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<PondPage />} />
            <Route path="/ask" element={<AskPage />} />
            <Route path="/open" element={<OpenPage />} />
            <Route path="/me" element={<MePage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/q/:id" element={<QuestionPage />} />
            <Route path="/miners" element={<MinersPage />} />
            <Route path="/moon" element={<MoonPage />} />
            <Route path="/how" element={<HowPage />} />
            <Route path="/token" element={<TokenPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </RouteFade>
      </main>
      <Footer />
      <Toaster />
      <LiveNotifier />
    </HashRouter>
  )
}
