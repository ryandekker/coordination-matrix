'use client';

import { Suspense } from 'react';
import { useAuth } from '@/lib/auth';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { GroupSelector } from './group-selector';

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
    <div className="flex h-screen overflow-hidden">
      <Suspense fallback={<div className="w-64 border-r bg-card" />}>
        <Sidebar />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Group/Project selector header */}
        <header className="flex h-14 items-center gap-4 border-b bg-card px-6">
          <GroupSelector />
        </header>
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
