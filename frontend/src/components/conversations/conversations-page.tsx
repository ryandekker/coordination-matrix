'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { conversationRecordsApi, ConversationRecord } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Bot,
  CheckCircle,
  XCircle,
  Clock,
  Terminal,
  DollarSign,
  Wrench,
} from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', icon: XCircle },
  running: { label: 'Running', color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', icon: Clock },
  timeout: { label: 'Timeout', color: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30', icon: Clock },
}

interface ConversationRowProps {
  record: ConversationRecord
}

function ConversationRow({ record }: ConversationRowProps) {
  const statusConfig = STATUS_CONFIG[record.status] || STATUS_CONFIG.completed
  const StatusIcon = statusConfig.icon
  const toolCalls = record.messages?.filter(m => m.type === 'tool_use').length || 0

  return (
    <Link
      href={`/conversations/${record._id}`}
      className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors text-xs"
    >
      {/* Status */}
      <div className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border', statusConfig.color)}>
        <StatusIcon className="h-3 w-3" />
        {statusConfig.label}
      </div>

      {/* Job name */}
      <span className="w-28 truncate font-medium text-foreground">
        {record.jobName || 'Manual'}
      </span>

      {/* Model */}
      <span className="w-32 truncate text-muted-foreground font-mono text-[10px]">
        {record.model?.replace('claude-', '') || 'unknown'}
      </span>

      {/* Session ID (shortened) */}
      <span className="w-20 truncate text-muted-foreground font-mono text-[10px]">
        {record.sessionId?.slice(0, 8)}...
      </span>

      {/* Stats */}
      <div className="flex items-center gap-3 text-muted-foreground">
        {/* Turns */}
        <span className="w-12" title="Conversation turns">
          {record.numTurns || 0} turns
        </span>

        {/* Tool calls */}
        {toolCalls > 0 && (
          <span className="flex items-center gap-1" title="Tool calls">
            <Wrench className="h-3 w-3" />
            {toolCalls}
          </span>
        )}

        {/* Duration */}
        {record.durationMs && (
          <span className="w-16" title="Duration">
            {(record.durationMs / 1000).toFixed(1)}s
          </span>
        )}

        {/* Cost */}
        {record.usage?.totalCostUsd !== undefined && (
          <span className="flex items-center gap-0.5 w-16" title="Cost">
            <DollarSign className="h-3 w-3" />
            {record.usage.totalCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Time */}
      <span className="ml-auto text-muted-foreground/70 w-24 text-right">
        {formatDistanceToNow(new Date(record.startedAt), { addSuffix: true })}
      </span>
    </Link>
  )
}

export function ConversationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Parse filters from URL
  const statusFromUrl = searchParams.get('status')
  const jobNameFromUrl = searchParams.get('jobName')
  const pageFromUrl = parseInt(searchParams.get('page') || '1', 10)

  const [selectedStatus, setSelectedStatus] = useState<string | null>(statusFromUrl)
  const [selectedJobName, setSelectedJobName] = useState<string | null>(jobNameFromUrl)
  const [page, setPage] = useState(pageFromUrl)
  const [records, setRecords] = useState<ConversationRecord[]>([])
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const limit = 50

  const fetchRecords = async () => {
    setIsFetching(true)
    try {
      const result = await conversationRecordsApi.list({
        status: selectedStatus || undefined,
        jobName: selectedJobName || undefined,
        limit,
        offset: (page - 1) * limit,
        sortBy: 'startedAt',
        sortOrder: 'desc',
      })
      setRecords(result.data)
      setTotal(result.pagination.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setIsLoading(false)
      setIsFetching(false)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [selectedStatus, selectedJobName, page])

  const totalPages = Math.ceil(total / limit)

  // Get unique job names for filter
  const jobNames = Array.from(new Set(records.map(r => r.jobName).filter((n): n is string => Boolean(n))))

  // Update URL when filters change
  const updateUrl = (
    newStatus: string | null,
    newJobName: string | null,
    newPage: number
  ) => {
    const params = new URLSearchParams()
    if (newStatus) params.set('status', newStatus)
    if (newJobName) params.set('jobName', newJobName)
    if (newPage > 1) params.set('page', String(newPage))
    const queryString = params.toString()
    router.push(queryString ? `/conversations?${queryString}` : '/conversations', { scroll: false })
  }

  const handleStatusChange = (value: string) => {
    const newStatus = value === 'all' ? null : value
    setSelectedStatus(newStatus)
    setPage(1)
    updateUrl(newStatus, selectedJobName, 1)
  }

  const handleJobNameChange = (value: string) => {
    const newJobName = value === 'all' ? null : value
    setSelectedJobName(newJobName)
    setPage(1)
    updateUrl(selectedStatus, newJobName, 1)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    updateUrl(selectedStatus, selectedJobName, newPage)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Agent Conversations
          </h1>
          <p className="text-xs text-muted-foreground">
            Conversation logs from daemon task execution
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchRecords()}
          disabled={isFetching}
          className="h-7 text-xs"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Terminal className="h-3 w-3 text-muted-foreground" />

        <Select value={selectedStatus || 'all'} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([value, config]) => (
              <SelectItem key={value} value={value} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <config.icon className="h-3 w-3" />
                  {config.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {jobNames.length > 0 && (
          <Select value={selectedJobName || 'all'} onValueChange={handleJobNameChange}>
            <SelectTrigger className="h-7 w-[150px] text-xs">
              <SelectValue placeholder="Job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Jobs</SelectItem>
              {jobNames.map((name) => (
                <SelectItem key={name} value={name!} className="text-xs">
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto text-muted-foreground">
          {records.length} of {total}
        </div>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/50 rounded-t-lg border border-b-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        <span className="w-20">Status</span>
        <span className="w-28">Job</span>
        <span className="w-32">Model</span>
        <span className="w-20">Session</span>
        <span className="flex-1">Stats</span>
        <span className="w-24 text-right">When</span>
      </div>

      {/* Records list */}
      <div className="border rounded-b-lg rounded-t-none bg-card -mt-3">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Loading conversations...
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-destructive">
            {error}
          </div>
        ) : records.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No conversation records found
          </div>
        ) : (
          <div>
            {records.map((record) => (
              <ConversationRow key={record._id} record={record} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="h-7 px-2 text-xs"
            >
              <ChevronLeft className="h-3 w-3" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="h-7 px-2 text-xs"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
