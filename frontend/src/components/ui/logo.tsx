import { cn } from '@/lib/utils'

interface LogoProps {
  className?: string
  size?: number
}

export function Logo({ className, size = 32 }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#3B82F6', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#1E3A5F', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Background rounded square */}
      <rect x="1" y="1" width="30" height="30" rx="6" fill="url(#logo-grad)" />

      {/* Connection lines between nodes */}
      <path
        d="M10 10 L22 10 M22 10 L16 22 M16 22 L10 10"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Network nodes - triangular arrangement */}
      <circle cx="10" cy="10" r="3.5" fill="#fff" />
      <circle cx="22" cy="10" r="3.5" fill="#fff" />
      <circle cx="16" cy="22" r="3.5" fill="#93C5FD" />
    </svg>
  )
}
