'use client'

import Link from 'next/link'
import { Settings, Database, Palette, Bell, Shield, Cog } from 'lucide-react'

const settingsItems = [
  {
    name: 'Field Configuration',
    description: 'Configure which fields are displayed, editable, and searchable',
    href: '/settings/fields',
    icon: Database,
  },
  {
    name: 'Appearance',
    description: 'Customize the look and feel of the application',
    href: '/settings/appearance',
    icon: Palette,
    disabled: true,
  },
  {
    name: 'Notifications',
    description: 'Configure notification preferences',
    href: '/settings/notifications',
    icon: Bell,
    disabled: true,
  },
  {
    name: 'Security',
    description: 'Manage security settings and API keys',
    href: '/settings/security',
    icon: Shield,
    disabled: true,
  },
]

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage application settings and configurations
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {settingsItems.map((item) => (
          <Link
            key={item.name}
            href={item.disabled ? '#' : item.href}
            className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
              item.disabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-muted'
            }`}
            onClick={(e) => item.disabled && e.preventDefault()}
          >
            <div className="rounded-lg bg-primary/10 p-2">
              <item.icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{item.name}</h3>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              {item.disabled && (
                <span className="mt-1 inline-block text-xs text-muted-foreground">
                  Coming soon
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
