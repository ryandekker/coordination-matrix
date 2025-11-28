'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ListTodo,
  Users,
  Settings,
  Workflow,
  AlertCircle,
  CheckCircle2,
  Clock,
  Cog,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'All Tasks', href: '/tasks', icon: ListTodo },
  { name: 'Awaiting Review', href: '/tasks?view=awaiting-review', icon: Clock },
  { name: 'HITL Queue', href: '/tasks?view=hitl', icon: AlertCircle },
  { name: 'Completed', href: '/tasks?view=completed', icon: CheckCircle2 },
  { name: 'Workflows', href: '/workflows', icon: Workflow },
  { name: 'Users', href: '/users', icon: Users },
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Field Config', href: '/settings/fields', icon: Cog },
]

export function Sidebar() {
  const pathname = usePathname()

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
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href.split('?')[0]))
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
