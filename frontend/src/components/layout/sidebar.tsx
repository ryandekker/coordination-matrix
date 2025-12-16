'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ListTodo,
  Users,
  Settings,
  Workflow,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Trash2,
  Play,
  LogOut,
  Key,
  User,
  LayoutDashboard,
  Database,
  Palette,
  Webhook,
  ArrowLeftRight,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { View } from '@/lib/api'
import { useViews, useDeleteView } from '@/hooks/use-tasks'
import { useAuth } from '@/lib/auth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChangePasswordDialog } from '@/components/auth/change-password-dialog'

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
  { name: 'Workflow Runs', href: '/workflow-runs', icon: Play, exact: false },
  { name: 'Requests', href: '/requests', icon: ArrowLeftRight, exact: false },
  { name: 'Users', href: '/users', icon: Users, exact: true },
]

const settingsNavigation: NavItem[] = [
  { name: 'Field Configuration', href: '/settings/fields', icon: Database, exact: true },
  { name: 'API Keys', href: '/settings/api-keys', icon: Key, exact: true },
  { name: 'Webhooks', href: '/settings/webhooks', icon: Webhook, exact: true },
  { name: 'Appearance', href: '/settings/appearance', icon: Palette, exact: true },
]

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentViewId = searchParams.get('viewId')
  const [savedSearchesExpanded, setSavedSearchesExpanded] = useState(true)
  const [settingsExpanded, setSettingsExpanded] = useState(() => pathname.startsWith('/settings'))
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const { user, logout } = useAuth()

  const { data: viewsData } = useViews('tasks')
  const deleteViewMutation = useDeleteView()

  // Filter out the default "All Tasks" view since we have that as a static nav item
  const views = (viewsData?.data || []).filter((v: View) => v.name !== 'All Tasks')

  const handleDeleteView = async (e: React.MouseEvent, viewId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('Are you sure you want to delete this saved search?')) {
      await deleteViewMutation.mutateAsync(viewId)
    }
  }

  const isStaticItemActive = (item: NavItem) => {
    const [itemPath] = item.href.split('?')
    // Normalize paths by removing trailing slashes for comparison
    const normalizedPathname = pathname.replace(/\/$/, '') || '/'
    const normalizedItemPath = itemPath.replace(/\/$/, '') || '/'

    if (item.exact) {
      // For /tasks, also check that no viewId is selected (to distinguish from saved searches)
      if (normalizedItemPath === '/tasks') {
        return normalizedPathname === normalizedItemPath && !currentViewId
      }
      return normalizedPathname === normalizedItemPath
    }

    return normalizedPathname.startsWith(normalizedItemPath)
  }

  const isViewActive = (view: View) => {
    const normalizedPathname = pathname.replace(/\/$/, '') || '/'
    return normalizedPathname === '/tasks' && currentViewId === view._id
  }

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} />
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
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
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
                    <div key={view._id} className="group relative">
                      <Link
                        href={`/tasks?viewId=${view._id}`}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary border-l-2 border-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Bookmark className="h-4 w-4" />
                        <span className="truncate flex-1">{view.name}</span>
                        {view.isSystem && (
                          <span className="text-xs opacity-50">System</span>
                        )}
                      </Link>
                      {!view.isSystem && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleDeleteView(e, view._id)}
                            className={cn(
                              'p-1 rounded',
                              isActive
                                ? 'hover:bg-destructive/20 text-destructive'
                                : 'hover:bg-destructive/20 text-destructive'
                            )}
                            title="Delete saved search"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
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
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            )
          })}

          {/* Settings Section */}
          <div className="mt-2">
            <button
              onClick={() => setSettingsExpanded(!settingsExpanded)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/settings')
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Settings className="h-4 w-4" />
              <span className="flex-1 text-left">Settings</span>
              {settingsExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            {settingsExpanded && (
              <div className="mt-1 ml-4 space-y-1">
                {settingsNavigation.map((item) => {
                  const isActive = isStaticItemActive(item)
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary border-l-2 border-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </nav>
      <div className="border-t p-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-muted transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="flex-1 text-left text-sm">
                <p className="font-medium truncate">{user?.displayName || 'User'}</p>
                <p className="text-muted-foreground truncate text-xs">{user?.email || ''}</p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
              <Key className="mr-2 h-4 w-4" />
              Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChangePasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
        />
      </div>
    </div>
  )
}
