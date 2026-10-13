import { Link } from 'react-router-dom'
import { FrogMascot, Wordmark } from './FrogMascot'

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="row" style={{ gap: 10 }}>
            <FrogMascot size={46} thinking title="hmm frog" />
            <Wordmark />
          </div>
          <p className="dim">Proof of thought. The coin you mine by asking the IMD swarm.</p>
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            No presale. No team allocation. No admin keys. No trackers on this site.
          </p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <div>
            <strong>Mine</strong>
            <Link to="/ask">Ask the swarm</Link>
            <Link to="/open">Open questions</Link>
            <Link to="/me">My thoughts</Link>
            <Link to="/miners">Miners</Link>
          </div>
          <div>
            <strong>Watch</strong>
            <Link to="/">The pond</Link>
            <Link to="/ledger">Ledger</Link>
            <Link to="/moon">The moon</Link>
          </div>
          <div>
            <strong>Learn</strong>
            <Link to="/how">How it works</Link>
            <Link to="/token">Token &amp; trust</Link>
            <Link to="/faq">FAQ</Link>
          </div>
        </nav>
      </div>
      <p className="footer-fine faint">
        HMM is an experiment. Asking spends IMD whether or not the swarm answers; only agreed answers mine. Nothing here
        is financial advice.
      </p>
    </footer>
  )
}
