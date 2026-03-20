'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  Activity,
  Tags,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Variable,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { Badge } from '@/components/ui/badge'
import { View, ViewFolder, authFetch } from '@/lib/api'
import { useViews, useDeleteView, useViewFolders, useCreateViewFolder, useUpdateViewFolder, useDeleteViewFolder, useUpdateView } from '@/hooks/use-tasks'
import { useAuth } from '@/lib/auth'
import { useSidebar } from '@/lib/sidebar-context'
import { useGroupContext } from '@/lib/group-context'
import { Building2, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { ChangePasswordDialog } from '@/components/auth/change-password-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

const staticNavigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, exact: true },
  { name: 'Projects', href: '/projects', icon: FolderKanban, exact: true },
  { name: 'All Tasks', href: '/tasks', icon: ListTodo, exact: true },
  { name: 'Documents', href: '/documents', icon: FileText, exact: true },
  { name: 'Activity', href: '/activity', icon: Activity, exact: true },
]

const bottomNavigation: NavItem[] = [
  { name: 'Workflows', href: '/workflows', icon: Workflow, exact: true },
  { name: 'Workflow Runs', href: '/workflow-runs', icon: Play, exact: false },
  { name: 'Conversations', href: '/conversations', icon: Bot, exact: false },
  { name: 'Requests', href: '/requests', icon: ArrowLeftRight, exact: false },
  { name: 'Users', href: '/users', icon: Users, exact: true },
]

const settingsNavigation: NavItem[] = [
  { name: 'Groups', href: '/settings/groups', icon: Users, exact: true },
  { name: 'Projects', href: '/settings/projects', icon: FolderKanban, exact: true },
  { name: 'Field Configuration', href: '/settings/fields', icon: Database, exact: true },
  { name: 'Tags', href: '/settings/tags', icon: Tags, exact: true },
  { name: 'Variables', href: '/settings/variables', icon: Variable, exact: true },
  { name: 'API Keys', href: '/settings/api-keys', icon: Key, exact: true },
  { name: 'Webhooks', href: '/settings/webhooks', icon: Webhook, exact: true },
  { name: 'Appearance', href: '/settings/appearance', icon: Palette, exact: true },
]

// View item component
function ViewItem({
  view,
  isActive,
  onEdit,
  isInFolder,
}: {
  view: View
  isActive: boolean
  onEdit: (view: View) => void
  isInFolder?: boolean
}) {
  return (
    <div className="group relative flex items-center">
      <Link
        href={`/tasks?viewId=${view._id}`}
        className={cn(
          'flex flex-1 items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
          isInFolder ? 'px-2' : 'px-3',
          isActive
            ? 'bg-primary/10 text-primary border-l-2 border-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
      >
        <Bookmark className="h-4 w-4 flex-shrink-0" />
        <span className="truncate flex-1">{view.name}</span>
      </Link>
      <button
        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
        onClick={(e) => {
          e.stopPropagation()
          onEdit(view)
        }}
      >
        <Pencil className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  )
}

// Folder item component with collapsible views
function FolderItem({
  folder,
  views,
  isViewActive,
  onEditView,
  onRenameFolder,
  onDeleteFolder,
}: {
  folder: ViewFolder
  views: View[]
  isViewActive: (view: View) => boolean
  onEditView: (view: View) => void
  onRenameFolder: (folder: ViewFolder) => void
  onDeleteFolder: (folder: ViewFolder) => void
}) {
  const [isExpanded, setIsExpanded] = useState(folder.isExpanded)
  const updateFolder = useUpdateViewFolder()

  const toggleExpanded = useCallback(() => {
    const newExpanded = !isExpanded
    setIsExpanded(newExpanded)
    // Persist expanded state
    updateFolder.mutate({ id: folder._id, data: { isExpanded: newExpanded } })
  }, [isExpanded, folder._id, updateFolder])

  const folderViews = views.filter(v => v.folderId === folder._id)
  const hasViews = folderViews.length > 0

  return (
    <div className="space-y-0.5">
      <div className="group relative flex items-center">
        <button
          onClick={toggleExpanded}
          className="flex flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="h-3 w-3 flex-shrink-0" />
              <FolderOpen className="h-4 w-4 flex-shrink-0" />
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3 flex-shrink-0" />
              <Folder className="h-4 w-4 flex-shrink-0" />
            </>
          )}
          <span className="truncate flex-1 text-left">{folder.name}</span>
          {hasViews && (
            <span className="text-xs text-muted-foreground/60">{folderViews.length}</span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onRenameFolder(folder)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeleteFolder(folder)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isExpanded && hasViews && (
        <div className="ml-5 pl-2 border-l border-border/50 space-y-0.5">
          {folderViews.map((view) => (
            <ViewItem
              key={view._id}
              view={view}
              isActive={isViewActive(view)}
              onEdit={onEditView}
              isInFolder
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  collapsed?: boolean
  onNavigate?: () => void
}

export function Sidebar({ collapsed = false, onNavigate }: SidebarProps = {}) {
  const { toggleCollapsed } = useSidebar()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentViewId = searchParams.get('viewId')
  const [savedSearchesExpanded, setSavedSearchesExpanded] = useState(true)
  const [settingsExpanded, setSettingsExpanded] = useState(() => pathname.startsWith('/settings'))
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const { user, logout } = useAuth()
  const { currentGroup, groups, setCurrentGroup, isLoadingGroups } = useGroupContext()

  // Check if user can switch groups (has more than one group)
  const canSwitchGroups = groups.length > 1

  // Dialog states
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [renameFolderOpen, setRenameFolderOpen] = useState(false)
  const [deleteFolderOpen, setDeleteFolderOpen] = useState(false)
  const [editViewOpen, setEditViewOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<ViewFolder | null>(null)
  const [selectedView, setSelectedView] = useState<View | null>(null)
  const [editViewName, setEditViewName] = useState('')
  const [editViewFolderId, setEditViewFolderId] = useState<string | null>(null)

  const { data: viewsData } = useViews('tasks')
  const { data: foldersData } = useViewFolders('tasks')
  const deleteViewMutation = useDeleteView()
  const createFolderMutation = useCreateViewFolder()
  const updateFolderMutation = useUpdateViewFolder()
  const deleteFolderMutation = useDeleteViewFolder()
  const updateViewMutation = useUpdateView()

  // Escalation badge: count of on_hold tasks with 'escalated' tag
  const { data: escalationData } = useQuery({
    queryKey: ['escalation-count'],
    queryFn: async () => {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'
      const res = await authFetch(`${API_BASE}/tasks?status=on_hold&tags=escalated&limit=1`)
      if (!res.ok) return { pagination: { total: 0 } }
      return res.json()
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
  const escalationCount = escalationData?.pagination?.total || 0

  // Filter out the default "All Tasks" view since we have that as a static nav item
  const allViews = useMemo(() =>
    (viewsData?.data || []).filter((v: View) => v.name !== 'All Tasks'),
    [viewsData?.data]
  )

  const folders = useMemo(() => foldersData?.data || [], [foldersData?.data])

  // Views not in any folder (root-level views)
  const rootViews = useMemo(() =>
    allViews.filter((v: View) => !v.folderId),
    [allViews]
  )

  const openEditViewDialog = (view: View) => {
    setSelectedView(view)
    setEditViewName(view.name)
    setEditViewFolderId(view.folderId || null)
    setEditViewOpen(true)
  }

  const handleEditView = async () => {
    if (!selectedView || !editViewName.trim()) return
    await updateViewMutation.mutateAsync({
      id: selectedView._id,
      data: {
        name: editViewName.trim(),
        folderId: editViewFolderId,
      },
    })
    setSelectedView(null)
    setEditViewName('')
    setEditViewFolderId(null)
    setEditViewOpen(false)
  }

  const handleDeleteView = async () => {
    if (!selectedView) return
    await deleteViewMutation.mutateAsync(selectedView._id)
    setSelectedView(null)
    setEditViewOpen(false)
  }

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return
    await createFolderMutation.mutateAsync({
      name: folderName.trim(),
      collectionName: 'tasks',
    })
    setFolderName('')
    setCreateFolderOpen(false)
  }

  const handleRenameFolder = async () => {
    if (!folderName.trim() || !selectedFolder) return
    await updateFolderMutation.mutateAsync({
      id: selectedFolder._id,
      data: { name: folderName.trim() },
    })
    setFolderName('')
    setSelectedFolder(null)
    setRenameFolderOpen(false)
  }

  const handleDeleteFolder = async () => {
    if (!selectedFolder) return
    await deleteFolderMutation.mutateAsync({ id: selectedFolder._id, moveViewsToRoot: true })
    setSelectedFolder(null)
    setDeleteFolderOpen(false)
  }

  const openRenameDialog = (folder: ViewFolder) => {
    setSelectedFolder(folder)
    setFolderName(folder.name)
    setRenameFolderOpen(true)
  }

  const openDeleteDialog = (folder: ViewFolder) => {
    setSelectedFolder(folder)
    setDeleteFolderOpen(true)
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

  const isViewActive = useCallback((view: View) => {
    const normalizedPathname = pathname.replace(/\/$/, '') || '/'
    return normalizedPathname === '/tasks' && currentViewId === view._id
  }, [pathname, currentViewId])

  const hasContent = allViews.length > 0 || folders.length > 0

  return (
    <TooltipProvider delayDuration={0}>
    <div data-testid="sidebar" className={cn(
      'flex h-full flex-col border-r bg-card transition-[width] duration-200',
      collapsed ? 'w-16' : 'w-64'
    )}>
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2" onClick={onNavigate}>
          <Logo size={collapsed ? 24 : 32} />
          {!collapsed && <span className="font-semibold">Coordination Matrix</span>}
        </Link>
      </div>
      <nav className={cn('flex-1 overflow-y-auto', collapsed ? 'p-2' : 'p-4')}>
        <div className="space-y-1">
          {staticNavigation.map((item) => {
            const isActive = isStaticItemActive(item)
            const linkContent = (
              <Link
                key={item.name}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-2' : 'px-3',
                  isActive
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span className="flex-1">{item.name}</span>}
                {!collapsed && item.name === 'Dashboard' && escalationCount > 0 && (
                  <Badge variant="destructive" className="h-5 min-w-[20px] px-1 text-[10px] font-semibold leading-none">
                    {escalationCount}
                  </Badge>
                )}
              </Link>
            )
            if (collapsed) {
              return (
                <Tooltip key={item.name} delayDuration={0}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              )
            }
            return linkContent
          })}
        </div>

        {/* Saved Searches Section */}
        {collapsed ? (
          <div className="mt-4 pt-4 border-t">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  className="flex w-full items-center justify-center rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label="Saved Searches"
                >
                  <Bookmark className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Saved Searches</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSavedSearchesExpanded(!savedSearchesExpanded)}
                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground"
              >
                {savedSearchesExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Saved Searches
              </button>
              {savedSearchesExpanded && (
                <button
                  onClick={() => setCreateFolderOpen(true)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Create folder"
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
              )}
            </div>
            {savedSearchesExpanded && (
              <div className="mt-1 space-y-0.5">
                {/* Folders */}
                {folders.map((folder) => (
                  <FolderItem
                    key={folder._id}
                    folder={folder}
                    views={allViews}
                    isViewActive={isViewActive}
                    onEditView={openEditViewDialog}
                    onRenameFolder={openRenameDialog}
                    onDeleteFolder={openDeleteDialog}
                  />
                ))}

                {/* Root-level views (not in any folder) */}
                {rootViews.map((view) => (
                  <ViewItem
                    key={view._id}
                    view={view}
                    isActive={isViewActive(view)}
                    onEdit={openEditViewDialog}
                  />
                ))}

                {/* Empty state */}
                {!hasContent && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No saved searches yet
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom Navigation */}
        <div className="mt-4 space-y-1 border-t pt-4">
          {bottomNavigation.map((item) => {
            const isActive = isStaticItemActive(item)
            const linkEl = (
              <Link
                key={item.name}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-2' : 'px-3',
                  isActive
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && item.name}
              </Link>
            )
            if (collapsed) {
              return (
                <Tooltip key={item.name} delayDuration={0}>
                  <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              )
            }
            return linkEl
          })}

          {/* Settings Section */}
          <div className="mt-2">
            {collapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href="/settings"
                    onClick={onNavigate}
                    className={cn(
                      'flex w-full items-center justify-center rounded-lg px-2 py-2 text-sm font-medium transition-colors',
                      pathname.startsWith('/settings')
                        ? 'bg-primary/10 text-primary border-l-2 border-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            ) : (
              <>
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
                          onClick={onNavigate}
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
              </>
            )}
          </div>
        </div>
      </nav>
      {/* Collapse/Expand toggle - only on desktop/tablet (not in mobile drawer) */}
      {!onNavigate && (
        <div className="border-t px-2 py-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={toggleCollapsed}
                className={cn(
                  'flex w-full items-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
                  collapsed ? 'justify-center' : 'gap-3 px-3'
                )}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4" />
                    <span className="text-sm">Collapse</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            )}
          </Tooltip>
        </div>
      )}
      <div className={cn('border-t', collapsed ? 'p-2' : 'p-4')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn(
              'flex w-full items-center rounded-lg hover:bg-muted transition-colors',
              collapsed ? 'justify-center p-2' : 'gap-3 p-2'
            )}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground flex-shrink-0">
                <User className="h-4 w-4" />
              </div>
              {!collapsed && (
                <>
                  <div className="flex-1 text-left text-sm min-w-0">
                    <p className="font-medium truncate">{user?.displayName || 'User'}</p>
                    <div className="flex items-center gap-1 text-muted-foreground text-xs">
                      <Building2 className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{currentGroup?.displayName || 'No group'}</span>
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canSwitchGroups && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Current Group
                </DropdownMenuLabel>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Building2 className="mr-2 h-4 w-4" />
                    {currentGroup?.displayName || 'Select group'}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {groups.map((group) => (
                      <DropdownMenuItem
                        key={group._id}
                        onClick={() => setCurrentGroup(group)}
                        className="flex items-center justify-between"
                      >
                        <span className="truncate">{group.displayName}</span>
                        {currentGroup?._id === group._id && (
                          <Check className="h-4 w-4 text-primary ml-2" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
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

      {/* Create Folder Dialog */}
      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              Create a new folder to organize your saved searches.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateFolder()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Folder Dialog */}
      <Dialog open={renameFolderOpen} onOpenChange={setRenameFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for this folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="Folder name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameFolder()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameFolder} disabled={!folderName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Dialog */}
      <Dialog open={deleteFolderOpen} onOpenChange={setDeleteFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the folder "{selectedFolder?.name}"?
              Views in this folder will be moved to the root level.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolderOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteFolder}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit View Dialog */}
      <Dialog open={editViewOpen} onOpenChange={setEditViewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Saved Search</DialogTitle>
            <DialogDescription>
              Update the name or folder for this saved search.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">Name</Label>
              <Input
                id="view-name"
                placeholder="Search name"
                value={editViewName}
                onChange={(e) => setEditViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleEditView()
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="view-folder">Folder</Label>
              <Select
                value={editViewFolderId || 'none'}
                onValueChange={(value) => setEditViewFolderId(value === 'none' ? null : value)}
              >
                <SelectTrigger id="view-folder">
                  <SelectValue placeholder="Select a folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder._id} value={folder._id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              onClick={handleDeleteView}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditViewOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditView} disabled={!editViewName.trim()}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
