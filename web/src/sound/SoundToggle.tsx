import { useSyncExternalStore } from 'react'
import { sound } from './engine'

/** A small speaker button: night sounds on/off (off by default, remembered). */
export function SoundToggle() {
  const on = useSyncExternalStore(sound.subscribe, sound.getEnabled, () => false)
  return (
    <button
      type="button"
      className={['sound-toggle', on && 'on'].filter(Boolean).join(' ')}
      aria-pressed={on}
      aria-label={on ? 'Turn pond sounds off' : 'Turn pond sounds on'}
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => {
        sound.setEnabled(!on)
        if (!on) setTimeout(() => sound.play('plip', 0.6, 0), 120)
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="sound-waves">
          <path d="M15.5 9a4 4 0 010 6" />
          <path d="M18.2 6.5a7.6 7.6 0 010 11" />
        </g>
        <path className="sound-x" d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )
}
