/** Small line icons for the question templates. */
export function TemplateIcon({ id }: { id: string }) {
  const common = {
    width: 34,
    height: 34,
    viewBox: '0 0 34 34',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'tpl-icon',
    'aria-hidden': true,
  }
  switch (id) {
    case 'log-count':
      return (
        <svg {...common}>
          <path d="M7 26V18M13 26V12M19 26V15M25 26V8" />
          <path d="M5 28h24" opacity="0.5" />
        </svg>
      )
    case 'log-threshold':
      return (
        <svg {...common}>
          <path d="M5 13h24" strokeDasharray="2 3" opacity="0.7" />
          <path d="M7 26l6-7 5 4 9-12" />
          <path d="M23 11h4v4" />
        </svg>
      )
    case 'balance-threshold':
      return (
        <svg {...common}>
          <rect x="5" y="10" width="24" height="16" rx="4" />
          <path d="M5 15h24" opacity="0.6" />
          <circle cx="23" cy="21" r="1.6" fill="currentColor" />
        </svg>
      )
    case 'supply-threshold':
      return (
        <svg {...common}>
          <ellipse cx="17" cy="9" rx="9" ry="3.5" />
          <path d="M8 9v6c0 2 4 3.5 9 3.5s9-1.5 9-3.5V9" />
          <path d="M8 15v6c0 2 4 3.5 9 3.5s9-1.5 9-3.5v-6" opacity="0.7" />
        </svg>
      )
    case 'eth-balance':
      return (
        <svg {...common}>
          <path d="M17 4l8 13-8 5-8-5 8-13z" />
          <path d="M9 20l8 10 8-10-8 5-8-5z" opacity="0.7" />
        </svg>
      )
    case 'pool-price':
      return (
        <svg {...common}>
          <path d="M5 25c5 0 6-14 12-14s6 10 12 10" />
          <circle cx="17" cy="11" r="2.2" fill="currentColor" />
          <path d="M5 29h24" opacity="0.5" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M21 7l6 6-14 14H7v-6L21 7z" />
          <path d="M18 10l6 6" opacity="0.7" />
        </svg>
      )
  }
}
