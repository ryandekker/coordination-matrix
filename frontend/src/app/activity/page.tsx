import { Suspense } from 'react'
import { ActivityFeedPage } from '@/components/activity-feed/activity-feed-page'

export default function Activity() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    }>
      <ActivityFeedPage />
    </Suspense>
  )
}
