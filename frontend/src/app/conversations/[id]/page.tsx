'use client'

import { Suspense } from 'react'
import { ConversationDetailPage } from '@/components/conversations/conversation-detail-page'

export default function ConversationDetail({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <ConversationDetailPage id={params.id} />
    </Suspense>
  )
}
