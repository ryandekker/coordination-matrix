'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AppearancePage() {
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  const themes = [
    {
      value: 'light',
      label: 'Light',
      description: 'A clean, bright interface',
      icon: Sun,
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Easy on the eyes, especially at night',
      icon: Moon,
    },
    {
      value: 'system',
      label: 'System',
      description: 'Follows your operating system preference',
      icon: Monitor,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Appearance</h1>
        <p className="text-muted-foreground">
          Customize how Coordination Matrix looks on your device
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Theme</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {themes.map((t) => (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              className={cn(
                'flex flex-col items-center gap-3 rounded-lg border p-6 transition-all',
                theme === t.value
                  ? 'border-primary bg-primary/5 ring-2 ring-primary'
                  : 'hover:bg-muted'
              )}
            >
              <div
                className={cn(
                  'rounded-full p-3',
                  theme === t.value ? 'bg-primary/10' : 'bg-muted'
                )}
              >
                <t.icon
                  className={cn(
                    'h-6 w-6',
                    theme === t.value ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
              </div>
              <div className="text-center">
                <h3 className="font-semibold">{t.label}</h3>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
