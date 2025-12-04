'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ListTodo,
  Users,
  Settings,
  Workflow,
  Cog,
  Bookmark,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { View } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

const staticNavigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, exact: true },
  { name: 'All Tasks', href: '/tasks', icon: ListTodo, exact: true },
]

const bottomNavigation: NavItem[] = [
  { name: 'Workflows', href: '/workflows', icon: Workflow, exact: true },
  { name: 'Users', href: '/users', icon: Users, exact: true },
  { name: 'Settings', href: '/settings', icon: Settings, exact: true },
  { name: 'Field Config', href: '/settings/fields', icon: Cog, exact: true },
]

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentViewId = searchParams.get('viewId')
  const [views, setViews] = useState<View[]>([])
  const [savedSearchesExpanded, setSavedSearchesExpanded] = useState(true)

  useEffect(() => {
    async function fetchViews() {
      try {
        const response = await fetch(`${API_BASE}/views?collectionName=tasks`)
        if (response.ok) {
          const data = await response.json()
          // Filter out the default "All Tasks" view since we have that as a static nav item
          setViews(data.data.filter((v: View) => v.name !== 'All Tasks'))
        }
      } catch (error) {
        console.error('Failed to fetch views:', error)
      }
    }
    fetchViews()
  }, [])

  const isStaticItemActive = (item: NavItem) => {
    const [itemPath] = item.href.split('?')

    if (item.exact) {
      return pathname === itemPath && !currentViewId
    }

    return pathname.startsWith(itemPath)
  }

  const isViewActive = (view: View) => {
    return pathname === '/tasks' && currentViewId === view._id
  }

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard className="h-4 w-4" />
          </div>
          <span className="font-semibold">Coordination Matrix</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          {staticNavigation.map((item) => {
            const isActive = isStaticItemActive(item)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            )
          })}
        </div>

        {/* Saved Searches Section */}
        {views.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setSavedSearchesExpanded(!savedSearchesExpanded)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
            >
              {savedSearchesExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Saved Searches
            </button>
            {savedSearchesExpanded && (
              <div className="mt-1 space-y-1">
                {views.map((view) => {
                  const isActive = isViewActive(view)
                  return (
                    <Link
                      key={view._id}
                      href={`/tasks?viewId=${view._id}`}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Bookmark className="h-4 w-4" />
                      <span className="truncate">{view.name}</span>
                      {view.isSystem && (
                        <span className="ml-auto text-xs opacity-50">System</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Bottom Navigation */}
        <div className="mt-4 space-y-1 border-t pt-4">
          {bottomNavigation.map((item) => {
            const isActive = isStaticItemActive(item)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            )
          })}
        </div>
      </nav>
      <div className="border-t p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <Users className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-medium">Admin User</p>
            <p className="text-muted-foreground">admin@example.com</p>
          </div>
        </div>
      </div>
    </div>
  )
}
