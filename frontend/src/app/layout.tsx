import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'
import { Providers } from './providers'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Coordination Matrix',
  description: 'AI Workflow Task Management with Human-in-the-Loop',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <div className="flex h-screen overflow-hidden">
            <Suspense fallback={<div className="w-64 border-r bg-card" />}>
              <Sidebar />
            </Suspense>
            <div className="flex flex-1 flex-col overflow-hidden">
              <Header />
              <main className="flex-1 overflow-auto p-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
