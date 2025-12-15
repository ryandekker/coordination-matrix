import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

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
      <body className="font-sans">
        <Providers>
          <AuthenticatedLayout>
            {children}
          </AuthenticatedLayout>
        </Providers>
      </body>
    </html>
  )
}
