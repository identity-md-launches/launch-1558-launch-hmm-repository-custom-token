import { useEffect, useRef, useState } from 'react'
import type { QuestionRec } from '../data/indexer'
import { answerLabel } from '../lib/answer'
import { formatHmm } from '../lib/format'
import { FrogMascot } from './FrogMascot'
import { Button, Modal } from './ui'
import { toast } from './toast'

const W = 1200
const H = 630

/** The post text: "I mined N $HMM by asking the IMD swarm: '<question>' — the swarm said <answer>". */
export function shareText(q: QuestionRec, hmm: bigint, maxLen = 280): string {
  const answer = q.answer ? answerLabel(q.answer.decoded) : 'its answer'
  const head = `I mined ${formatHmm(hmm)} $HMM by asking the IMD swarm: '`
  const tail = `' — the swarm said ${answer}`
  const room = Math.max(20, maxLen - head.length - tail.length)
  const question = q.text.length > room ? `${q.text.slice(0, room - 1).trimEnd()}…` : q.text
  return `${head}${question}${tail}`
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else line = test
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1]!
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length) last = last.slice(0, -1)
    lines[maxLines - 1] = `${last.trimEnd()}…`
  }
  // Long unbroken tokens (addresses) can still overflow: hard-cut them.
  return lines.map((l) => {
    let s = l
    while (ctx.measureText(s).width > maxWidth && s.length > 4) s = s.slice(0, -2)
    return s === l ? l : `${s}…`
  })
}

async function draw(canvas: HTMLCanvasElement, q: QuestionRec, hmm: bigint, frogSvg: string | null) {
  const ctx = canvas.getContext('2d')!
  canvas.width = W
  canvas.height = H
  await Promise.all([
    document.fonts.load('800 64px "Bricolage Grotesque Variable"'),
    document.fonts.load('600 28px "Inter Variable"'),
    document.fonts.load('600 28px "JetBrains Mono Variable"'),
  ]).catch(() => undefined)

  // night sky into pond
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0c1116')
  bg.addColorStop(0.55, '#0f1c1f')
  bg.addColorStop(1, '#10201f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // stars (deterministic)
  let seed = Number(q.id % 997n) + 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(243,234,211,${0.15 + rnd() * 0.5})`
    ctx.beginPath()
    ctx.arc(rnd() * W, rnd() * H * 0.6, rnd() * 1.4 + 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  // moon glow
  const mx = W - 150
  const my = 120
  const glow = ctx.createRadialGradient(mx, my, 10, mx, my, 260)
  glow.addColorStop(0, 'rgba(243,234,211,0.35)')
  glow.addColorStop(1, 'rgba(243,234,211,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#f3ead3'
  ctx.beginPath()
  ctx.arc(mx, my, 54, 0, Math.PI * 2)
  ctx.fill()
  // reflection on the water
  ctx.fillStyle = 'rgba(255,207,74,0.08)'
  for (let i = 0; i < 9; i++) {
    const y = 470 + i * 16
    ctx.fillRect(mx - 60 + Math.sin(i * 1.7) * 18, y, 120 - i * 8, 3)
  }
  // lily pad + frog
  ctx.fillStyle = '#3f7d5c'
  ctx.beginPath()
  ctx.ellipse(1010, 560, 170, 46, 0, 0.25, Math.PI * 2 - 0.05)
  ctx.lineTo(1010, 560)
  ctx.fill()
  if (frogSvg) {
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(frogSvg)}`
    await img.decode().catch(() => undefined)
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 900, 330, 240, 240)
  }

  // wordmark
  ctx.fillStyle = '#f3ead3'
  ctx.font = '800 54px "Bricolage Grotesque Variable", sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('hmm', 64, 104)
  const wm = ctx.measureText('hmm').width
  ctx.fillStyle = '#c9b8ff'
  ;[
    [wm + 76, 98, 4],
    [wm + 88, 88, 5.5],
    [wm + 102, 74, 7],
  ].forEach(([x, y, r]) => {
    ctx.beginPath()
    ctx.arc(x!, y!, r!, 0, Math.PI * 2)
    ctx.fill()
  })

  // headline
  ctx.font = '800 70px "Bricolage Grotesque Variable", sans-serif'
  const g = ctx.createLinearGradient(64, 0, 760, 0)
  g.addColorStop(0, '#ffe7a0')
  g.addColorStop(0.5, '#ffcf4a')
  g.addColorStop(1, '#ffb21f')
  ctx.fillStyle = g
  ctx.fillText(`I mined ${formatHmm(hmm)} HMM`, 64, 210)

  // the question
  ctx.fillStyle = 'rgba(243,234,211,0.92)'
  ctx.font = '600 30px "Inter Variable", sans-serif'
  const lines = wrap(ctx, `“${q.text}”`, 780, 4)
  lines.forEach((l, i) => ctx.fillText(l, 64, 280 + i * 42))

  // the answer
  const y = 280 + lines.length * 42 + 40
  ctx.font = '600 26px "Inter Variable", sans-serif'
  ctx.fillStyle = 'rgba(243,234,211,0.6)'
  ctx.fillText('the swarm said', 64, y)
  const label = q.answer ? answerLabel(q.answer.decoded) : '…'
  ctx.font = '700 34px "JetBrains Mono Variable", monospace'
  const lw = ctx.measureText(label).width
  const x0 = 64 + ctx.measureText('the swarm said').width * (26 / 34) + 28
  ctx.fillStyle = 'rgba(143,209,138,0.14)'
  ctx.strokeStyle = 'rgba(143,209,138,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x0 - 14, y - 36, lw + 28, 50, 14)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#8fd18a'
  ctx.fillText(label, x0, y)

  // footer
  ctx.font = '500 22px "JetBrains Mono Variable", monospace'
  ctx.fillStyle = 'rgba(243,234,211,0.5)'
  const panel = q.answer ? ` · ${q.answer.agreed}/${q.answer.panelSize} agents agreed` : ''
  ctx.fillText(`proof of thought · question #${q.id}${q.round !== undefined ? ` · round ${q.round}` : ''}${panel}`, 64, H - 48)
}

export function ShareCardButton({ q, hmm }: { q: QuestionRec; hmm: bigint }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="gold" onClick={() => setOpen(true)}>
        Share “I mined”
      </Button>
      {open && <ShareCardModal q={q} hmm={hmm} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareCardModal({ q, hmm, onClose }: { q: QuestionRec; hmm: bigint; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const frog = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const text = shareText(q, hmm)

  useEffect(() => {
    const svg = frog.current?.querySelector('svg')
    const markup = svg ? new XMLSerializer().serializeToString(svg) : null
    if (canvas.current) void draw(canvas.current, q, hmm, markup).then(() => setReady(true))
  }, [q, hmm])

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `hmm-mined-question-${q.id}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }, 'image/png')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ kind: 'success', title: 'Copied', body: 'Paste it on X with the image.', ttl: 4000 })
    } catch {
      toast.show({ kind: 'error', title: 'Copy failed', body: 'Your browser blocked the clipboard.', ttl: 5000 })
    }
  }

  return (
    <Modal open onClose={onClose} title="Share what you mined" wide>
      <div className="stack-lg">
        <div ref={frog} style={{ display: 'none' }} aria-hidden="true">
          <FrogMascot size={240} blink={false} />
        </div>
        <canvas ref={canvas} className="share-canvas" width={W} height={H} aria-label="Share card preview" />
        <p className="blob" style={{ maxHeight: 120 }}>
          {text}
        </p>
        <div className="row">
          <Button variant="gold" onClick={download} disabled={!ready}>
            Download image
          </Button>
          <Button onClick={copy}>Copy text</Button>
          <a
            className="btn btn-ghost"
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open X ↗
          </a>
        </div>
        <p className="faint" style={{ fontSize: '0.8rem' }}>
          The image is drawn in your browser; nothing is uploaded.
        </p>
      </div>
    </Modal>
  )
}
