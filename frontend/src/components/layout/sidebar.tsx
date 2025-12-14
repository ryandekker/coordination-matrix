'use client'

import { useState } from 'react'
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
  Trash2,
  LogOut,
  Key,
  User,
} from 'lucide-react'
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
  { name: 'Users', href: '/users', icon: Users, exact: true },
  { name: 'Settings', href: '/settings', icon: Settings, exact: true },
  { name: 'Field Config', href: '/settings/fields', icon: Cog, exact: true },
]

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentViewId = searchParams.get('viewId')
  const [savedSearchesExpanded, setSavedSearchesExpanded] = useState(true)
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
                    <div key={view._id} className="group relative">
                      <Link
                        href={`/tasks?viewId=${view._id}`}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
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
                                ? 'hover:bg-primary-foreground/20 text-primary-foreground'
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg p-2 hover:bg-muted transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
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
