'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { useSidebar } from '@/lib/sidebar-context'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/tasks': 'Tasks',
  '/projects': 'Projects',
  '/documents': 'Documents',
  '/activity': 'Activity',
  '/workflows': 'Workflows',
  '/workflow-runs': 'Workflow Runs',
  '/conversations': 'Conversations',
  '/requests': 'Requests',
  '/users': 'Users',
  '/settings': 'Settings',
  '/settings/groups': 'Groups',
  '/settings/projects': 'Projects',
  '/settings/fields': 'Fields',
  '/settings/tags': 'Tags',
  '/settings/variables': 'Variables',
  '/settings/api-keys': 'API Keys',
  '/settings/webhooks': 'Webhooks',
  '/settings/appearance': 'Appearance',
}

function getPageTitle(pathname: string): string {
  // Exact match first
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  // Try without trailing slash
  const normalized = pathname.replace(/\/$/, '') || '/'
  if (PAGE_TITLES[normalized]) return PAGE_TITLES[normalized]
  // Try prefix match for nested routes
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (normalized.startsWith(path) && path !== '/') return title
  }
  return 'Coordination Matrix'
}

export function MobileHeader({ className }: { className?: string }) {
  const { setIsOpen } = useSidebar()
  const pathname = usePathname()
  const pageTitle = getPageTitle(pathname)

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-card px-3',
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => setIsOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Logo size={24} />
      <span className="flex-1 truncate text-sm font-semibold">{pageTitle}</span>
    </header>
  )
}
