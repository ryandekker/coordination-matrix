'use client';

import { Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Sidebar } from './sidebar';
import { MobileSidebar } from './mobile-sidebar';
import { MobileHeader } from './mobile-header';
import { SidebarProvider, useSidebar } from '@/lib/sidebar-context';
import { useGroupContext } from '@/lib/group-context';
import { cn } from '@/lib/utils';
import { AlertCircle, Users } from 'lucide-react';

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  // Don't show layout on login page (check both with and without trailing slash)
  if (pathname === '/login' || pathname === '/login/') {
    return <>{children}</>;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If not authenticated, show loading while AuthProvider redirects to login
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AuthenticatedLayoutInner>{children}</AuthenticatedLayoutInner>
    </SidebarProvider>
  );
}

function AuthenticatedLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop/Tablet sidebar (hidden on mobile) */}
      <div className="hidden md:block">
        <Suspense fallback={<div className={cn('border-r bg-card h-full', collapsed ? 'w-16' : 'w-64')} />}>
          <Sidebar collapsed={collapsed} />
        </Suspense>
      </div>

      {/* Mobile sidebar drawer */}
      <div className="md:hidden">
        <MobileSidebar />
      </div>

      <main className="flex-1 overflow-auto flex flex-col min-w-0">
        {/* Mobile header with hamburger */}
        <div className="md:hidden">
          <MobileHeader />
        </div>
        <NoGroupBanner />
        <div className="flex-1 p-3 md:p-4 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  );
}

function NoGroupBanner() {
  const { user } = useAuth();
  const { groups, isLoadingGroups } = useGroupContext();

  // Don't show banner while loading
  if (isLoadingGroups) return null;

  // User has groups, no banner needed
  if (groups.length > 0) return null;

  // Admins see a different message
  const isAdmin = user?.role === 'admin';

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-3 md:px-6 py-3">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
        <div className="flex-1">
          {isAdmin ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              You are not a member of any group. As an admin, you can still view all content.{' '}
              <Link href="/settings/groups" className="font-medium underline hover:no-underline">
                Manage groups
              </Link>
            </p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              You are not a member of any group. Contact your administrator to be added to a group, or{' '}
              <Link href="/settings/groups" className="font-medium underline hover:no-underline">
                view available groups
              </Link>
            </p>
          )}
        </div>
        <Users className="h-5 w-5 text-amber-500 flex-shrink-0 hidden sm:block" />
      </div>
    </div>
  );
}
