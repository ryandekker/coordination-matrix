'use client'

export const runtime = 'edge'

import { Suspense } from 'react'
import { ConversationsPage } from '@/components/conversations/conversations-page'

export default function Conversations() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <ConversationsPage />
    </Suspense>
  )
}
