import { useId } from 'react'

/**
 * The hmm frog: a round, friendly frog in a thinking pose, hand on chin, eyes up and to the right.
 * Drawn as a sticker: an outline pass under a fill pass, so overlapping parts read as one silhouette.
 */
export function FrogMascot({
  size = 160,
  thinking = true,
  blink = true,
  title = 'the hmm frog, thinking',
  className,
}: {
  size?: number | string
  /** Show the three-dot thought trail. */
  thinking?: boolean
  /** Animate blinking and the thought trail (disabled under prefers-reduced-motion by CSS). */
  blink?: boolean
  title?: string
  className?: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const skin = `skin${uid}`
  const shade = `shade${uid}`
  const body = 'M30 168C30 112 72 88 120 88C168 88 210 112 210 168C210 200 172 214 120 214C68 214 30 200 30 168Z'
  const thinkArm = 'M199 158C194 182 178 196 163 193C151 190 144 172 142 155'
  const restArm = 'M50 180C66 198 116 206 166 194'
  return (
    <svg
      className={['frog-mascot', blink ? 'frog-animated' : '', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 240 240"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <radialGradient id={skin} cx="38%" cy="30%" r="78%">
          <stop offset="0" stopColor="#a9e2a2" />
          <stop offset="0.55" stopColor="#8fd18a" />
          <stop offset="1" stopColor="#6fb874" />
        </radialGradient>
        <radialGradient id={shade} cx="50%" cy="0%" r="100%">
          <stop offset="0.6" stopColor="#0c1116" stopOpacity="0" />
          <stop offset="1" stopColor="#0c1116" stopOpacity="0.18" />
        </radialGradient>
      </defs>

      {/* outline pass */}
      <g fill="#3f7d5c" stroke="#3f7d5c" strokeWidth="10" strokeLinejoin="round">
        <ellipse cx="70" cy="214" rx="27" ry="10" />
        <ellipse cx="170" cy="214" rx="27" ry="10" />
        <path d={body} />
        <circle cx="82" cy="86" r="32" />
        <circle cx="158" cy="86" r="32" />
      </g>
      {/* fill pass */}
      <g fill={`url(#${skin})`}>
        <ellipse cx="70" cy="214" rx="27" ry="10" fill="#79c178" />
        <ellipse cx="170" cy="214" rx="27" ry="10" fill="#79c178" />
        <path d={body} />
        <circle cx="82" cy="86" r="32" />
        <circle cx="158" cy="86" r="32" />
      </g>
      <path d={body} fill={`url(#${shade})`} />

      {/* toes */}
      <g fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3">
        <circle cx="50" cy="217" r="6" />
        <circle cx="64" cy="221" r="6" />
        <circle cx="190" cy="217" r="6" />
        <circle cx="176" cy="221" r="6" />
      </g>

      {/* belly and freckles */}
      <ellipse cx="118" cy="180" rx="58" ry="31" fill="#d6f0c4" opacity="0.92" />
      <g fill="#5fa46a" opacity="0.55">
        <circle cx="110" cy="104" r="4.2" />
        <circle cx="124" cy="98" r="3" />
        <circle cx="134" cy="107" r="3.4" />
      </g>

      {/* eyes: looking up and to the right */}
      <g className="frog-eye">
        <circle cx="82" cy="84" r="22" fill="#fbf6e9" />
        <circle cx="89" cy="76" r="10.5" fill="#0c1116" />
        <circle cx="93" cy="71.5" r="3.6" fill="#ffffff" />
      </g>
      <g className="frog-eye">
        <circle cx="158" cy="84" r="22" fill="#fbf6e9" />
        <circle cx="165" cy="76" r="10.5" fill="#0c1116" />
        <circle cx="169" cy="71.5" r="3.6" fill="#ffffff" />
      </g>

      {/* cheeks and the pondering mouth */}
      <ellipse cx="66" cy="130" rx="12" ry="7" fill="#ffb3a6" opacity="0.5" />
      <ellipse cx="174" cy="128" rx="12" ry="7" fill="#ffb3a6" opacity="0.5" />
      <path
        d="M102 133C108 128.5 114 137 120 133S132 128.5 138 133"
        fill="none"
        stroke="#0c1116"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* resting arm */}
      <path d={restArm} fill="none" stroke="#3f7d5c" strokeWidth="24" strokeLinecap="round" />
      <path d={restArm} fill="none" stroke="#86cb83" strokeWidth="14" strokeLinecap="round" />
      {/* thinking arm, hand on chin */}
      <path d={thinkArm} fill="none" stroke="#3f7d5c" strokeWidth="25" strokeLinecap="round" />
      <path d={thinkArm} fill="none" stroke="#86cb83" strokeWidth="15" strokeLinecap="round" />
      <g fill="#8fd18a" stroke="#3f7d5c" strokeWidth="3.5">
        <circle cx="141" cy="150" r="8" />
        <circle cx="134" cy="143" r="6.5" />
        <circle cx="147" cy="142" r="6.5" />
      </g>

      {thinking && (
        <g className="frog-thought" fill="#c9b8ff">
          <circle cx="197" cy="50" r="5" />
          <circle cx="210" cy="32" r="7" />
          <circle cx="226" cy="12" r="9" />
        </g>
      )}
    </svg>
  )
}

/** The lowercase wordmark: "hmm" and a three-dot thought trail. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={['wordmark', className].filter(Boolean).join(' ')} aria-label="hmm">
      <span aria-hidden="true">hmm</span>
      <span className="wordmark-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  )
}
