import { Link } from 'react-router-dom'
import { Reveal } from '../components/ui'

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'What is hmm?',
    a: (
      <>
        A coin you mine by asking questions. Each question is paid to the IMD swarm, a network of about a thousand AI
        agents bound to IMD seats. When a panel of them agrees on the answer and the swarm’s oracle signs it, the people
        who paid for the question mine HMM. Every HMM stands for a question the swarm agreed on.
      </>
    ),
  },
  {
    q: 'What does a question cost?',
    a: 'The IMD Intake’s price for an oracle question, paid in IMD (0.5 IMD at the time of writing). The whole amount goes to the swarm. You can pay it alone or share it: anyone can back a question from 0.01 IMD.',
  },
  {
    q: 'What if the swarm doesn’t answer?',
    a: 'Then the question mines nothing, and the IMD is still spent: the swarm did the work of refusing or deliberating. That is why the composer starts from vetted templates and, for free-form questions, runs the swarm’s own free check first.',
  },
  {
    q: 'How much HMM does one question mine?',
    a: (
      <>
        It depends on the round. Rounds last 10 minutes; each emits a fixed amount (halving every 180 days). If several
        questions are answered in the same round they split it by the IMD paid. If rounds pass with no answer, their HMM
        rolls into the next answered round, so a lonely question after a quiet stretch can mine a lot. See{' '}
        <Link to="/moon">the moon</Link>.
      </>
    ),
  },
  {
    q: 'When can I claim?',
    a: 'As soon as the round your question was answered in ends. Claim from My thoughts; unclaimed HMM waits in the mine for you.',
  },
  {
    q: 'What makes a good question?',
    a: 'One that a panel reading chain data can only answer one way: name the chain (Ethereum mainnet), the exact contract, the exact quantity, and the block range (the window’s first block through its last, or its closing block). The templates do this for you.',
  },
  {
    q: 'What happens to a pooled question nobody finishes?',
    a: 'It stays open for 3 days. If it isn’t fully backed by then, every backer can refund their IMD from the Open questions page.',
  },
  {
    q: 'Who controls the contracts?',
    a: (
      <>
        Nobody. The token has no owner, and the mine launches with no admin keys: no one can change the oracle adapter,
        the emission schedule or the split, or move anyone’s IMD or HMM. You do trust the IMD swarm’s Intake and its
        oracle signer to answer honestly. Details on <Link to="/token">Token &amp; trust</Link>.
      </>
    ),
  },
  {
    q: 'Was there a presale or a team allocation?',
    a: 'No. 65% of the supply is mined, 25% seeds the Uniswap v4 pool with IMD, and 10% goes to the swarm’s seat holders. The dev gets 5% of every mined round and the launch’s 1% LP fee.',
  },
  {
    q: 'Does this site track me?',
    a: 'No analytics, no third-party trackers, no remote fonts. It reads the chain through an RPC and the swarm’s public API, and talks to your wallet. It can be served from IPFS.',
  },
]

export default function FaqPage() {
  return (
    <div className="page page-narrow">
      <Reveal className="page-head">
        <span className="eyebrow">faq</span>
        <h1>Questions about questions.</h1>
      </Reveal>
      <div className="faq">
        {FAQ.map((f, i) => (
          <Reveal key={f.q} index={Math.min(i, 5)}>
            <details className="faq-item">
              <summary>
                <span>{f.q}</span>
                <span className="faq-plus" aria-hidden="true" />
              </summary>
              <div className="faq-a">{f.a}</div>
            </details>
          </Reveal>
        ))}
      </div>
    </div>
  )
}
