'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { conversationRecordsApi, ConversationRecord, ConversationMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  RefreshCw,
  Bot,
  User,
  Terminal,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Wrench,
  AlertTriangle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  completed: { label: 'Completed', color: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', icon: XCircle },
  running: { label: 'Running', color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', icon: Clock },
  timeout: { label: 'Timeout', color: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30', icon: Clock },
}

interface MessageBlockProps {
  message: ConversationMessage
  index: number
}

function MessageBlock({ message, index }: MessageBlockProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyContent = () => {
    const content = message.type === 'tool_use'
      ? JSON.stringify(message.toolInput, null, 2)
      : message.type === 'tool_result'
        ? typeof message.toolResult === 'string' ? message.toolResult : JSON.stringify(message.toolResult, null, 2)
        : typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)

    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getIcon = () => {
    switch (message.type) {
      case 'assistant':
        return <Bot className="h-4 w-4" />
      case 'user':
        return <User className="h-4 w-4" />
      case 'tool_use':
        return <Terminal className="h-4 w-4" />
      case 'tool_result':
        return message.isError ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />
      default:
        return <Terminal className="h-4 w-4" />
    }
  }

  const getHeaderColor = () => {
    switch (message.type) {
      case 'assistant':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
      case 'user':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
      case 'tool_use':
        return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
      case 'tool_result':
        return message.isError
          ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
          : 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
      default:
        return 'bg-muted'
    }
  }

  const getLabel = () => {
    switch (message.type) {
      case 'assistant':
        return 'Assistant'
      case 'user':
        return 'User'
      case 'tool_use':
        return `Tool Call: ${message.toolName}`
      case 'tool_result':
        return `Tool Result${message.isError ? ' (Error)' : ''}`
      default:
        return message.type
    }
  }

  const renderContent = () => {
    if (message.type === 'tool_use') {
      return (
        <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(message.toolInput, null, 2)}
        </pre>
      )
    }

    if (message.type === 'tool_result') {
      const result = message.toolResult
      if (typeof result === 'string') {
        return (
          <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {result}
          </pre>
        )
      }
      return (
        <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )
    }

    if (typeof message.content === 'string') {
      return (
        <div className="text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      )
    }

    return (
      <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(message.content, null, 2)}
      </pre>
    )
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium border-b transition-colors',
          getHeaderColor()
        )}
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {getIcon()}
        <span>{getLabel()}</span>
        {message.toolUseId && (
          <span className="text-[10px] font-mono opacity-60 ml-2">
            {message.toolUseId.slice(0, 12)}...
          </span>
        )}
        <span className="ml-auto text-[10px] opacity-60">
          #{index + 1}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            copyContent()
          }}
          className="h-5 w-5 p-0 ml-2"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </button>
      {isExpanded && (
        <div className="p-3 bg-card">
          {renderContent()}
        </div>
      )}
    </div>
  )
}

interface ConversationDetailPageProps {
  id: string
}

export function ConversationDetailPage({ id }: ConversationDetailPageProps) {
  const [record, setRecord] = useState<ConversationRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRecord = async () => {
    setIsLoading(true)
    try {
      const result = await conversationRecordsApi.get(id)
      setRecord(result.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchRecord()
  }, [id])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (error || !record) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{error || 'Conversation not found'}</p>
        <Link href="/conversations">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to list
          </Button>
        </Link>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[record.status] || STATUS_CONFIG.completed
  const StatusIcon = statusConfig.icon
  const toolCalls = record.messages?.filter(m => m.type === 'tool_use').length || 0
  const toolResultErrors = record.messages?.filter(m => m.type === 'tool_result' && m.isError) || []
  const permissionDenials = record.permissionDenials || []
  const totalErrors = permissionDenials.length + toolResultErrors.length

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/conversations">
          <Button variant="ghost" size="sm" className="h-8">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>

        <div className="flex-1">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Conversation Details
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {record.sessionId}
          </p>
        </div>

        <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border', statusConfig.color)}>
          <StatusIcon className="h-3 w-3" />
          {statusConfig.label}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchRecord()}
          className="h-8"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-[10px] uppercase text-muted-foreground">Job</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-sm font-medium">{record.jobName || 'Manual'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-[10px] uppercase text-muted-foreground">Model</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-sm font-mono">{record.model?.replace('claude-', '') || 'unknown'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-[10px] uppercase text-muted-foreground">Duration</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-sm font-medium">
              {record.durationMs ? `${(record.durationMs / 1000).toFixed(2)}s` : '-'}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-[10px] uppercase text-muted-foreground">Cost</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <span className="text-sm font-medium flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              {record.usage?.totalCostUsd?.toFixed(4) || '0.0000'}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{record.numTurns || 0}</strong> turns
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          <strong className="text-foreground">{toolCalls}</strong> tool calls
        </span>
        {totalErrors > 0 && (
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3" />
            <strong>{totalErrors}</strong> error{totalErrors !== 1 ? 's' : ''}
          </span>
        )}
        {record.usage && (
          <>
            <span>
              <strong className="text-foreground">{record.usage.inputTokens?.toLocaleString()}</strong> input tokens
            </span>
            <span>
              <strong className="text-foreground">{record.usage.outputTokens?.toLocaleString()}</strong> output tokens
            </span>
          </>
        )}
        <span className="ml-auto">
          Started {format(new Date(record.startedAt), 'PPpp')}
        </span>
      </div>

      {/* Task link */}
      {record.taskId && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Task:</span>
          <Link
            href={`/tasks?taskId=${record.taskId}`}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {record.taskId}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* Errors summary: permission denials + tool result errors */}
      {totalErrors > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              Errors ({totalErrors})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-3">
            {permissionDenials.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Permission Denials ({permissionDenials.length})
                </div>
                {permissionDenials.map((denial, i) => (
                  <div key={`denial-${i}`} className="text-xs bg-yellow-500/10 p-2 rounded">
                    <span className="font-medium">{denial.toolName}</span>
                    <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
                      {JSON.stringify(denial.toolInput, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
            {toolResultErrors.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-medium text-red-600 dark:text-red-400">
                  Tool Errors ({toolResultErrors.length})
                </div>
                {toolResultErrors.map((msg, i) => {
                  const errorText = typeof msg.toolResult === 'string'
                    ? msg.toolResult
                    : JSON.stringify(msg.toolResult, null, 2)
                  return (
                    <div key={`toolerr-${i}`} className="text-xs bg-red-500/10 p-2 rounded">
                      <span className="font-medium font-mono text-[10px]">{msg.toolUseId || `#${i + 1}`}</span>
                      <pre className="mt-1 text-[10px] text-red-600 dark:text-red-400 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
                        {errorText}
                      </pre>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error info */}
      {record.error && (
        <Card className="border-red-500/30">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">
              {record.error}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Conversation thread */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Conversation Thread
          <Badge variant="outline" className="text-[10px]">
            {record.messages?.length || 0} messages
          </Badge>
        </h2>

        {record.messages && record.messages.length > 0 ? (
          <div className="space-y-2">
            {record.messages.map((message, index) => (
              <MessageBlock key={index} message={message} index={index} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground p-4 border rounded-lg text-center">
            No messages recorded (conversation may have used --print mode without stream-json)
          </div>
        )}
      </div>

      {/* Final result */}
      {record.result && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs">Final Result</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
              {record.result}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Stderr */}
      {record.stderr && (
        <Card className="border-yellow-500/30">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs text-yellow-600 dark:text-yellow-400">Stderr Output</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <pre className="text-xs text-yellow-600 dark:text-yellow-400 whitespace-pre-wrap">
              {record.stderr}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
