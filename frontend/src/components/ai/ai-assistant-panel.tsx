'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Sparkles,
  Loader2,
  Trash2,
  ExternalLink,
  AlertCircle,
  MessageSquare,
  Pencil,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownContent } from '@/components/ui/markdown-content'
import { useAiAssistant, AiMessage, AiIntentMode } from '@/hooks/use-ai-assistant'
import { cn } from '@/lib/utils'

interface AiAssistantPanelProps {
  contextType: 'document' | 'workflow'
  contextId: string
  className?: string
  onContentUpdated?: () => void
}

export function AiAssistantPanel({
  contextType,
  contextId,
  className,
  onContentUpdated,
}: AiAssistantPanelProps) {
  const {
    messages,
    isProcessing,
    error,
    activeTaskId,
    sendMessage,
    retryWithMode,
    clearMessages,
  } = useAiAssistant(contextType, contextId)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevMessageCountRef = useRef(0)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length
      // If an edit was applied, notify parent
      const lastMsg = messages[messages.length - 1]
      if (lastMsg?.role === 'assistant' && lastMsg.editSummary) {
        onContentUpdated?.()
      }
      // Scroll to bottom
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      }, 100)
    }
  }, [messages, onContentUpdated])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isProcessing) return
    setInput('')
    sendMessage(trimmed)
  }, [input, isProcessing, sendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const contextLabel = contextType === 'document' ? 'document' : 'workflow'

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-violet-500" />
          AI Assistant
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={clearMessages}
            title="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="p-3 space-y-3">
          {messages.length === 0 && !isProcessing && (
            <div className="text-center text-sm text-muted-foreground py-8 space-y-2">
              <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/30" />
              <p>Ask a question or request an edit</p>
              <p className="text-xs">
                Try: &quot;{contextType === 'document'
                  ? 'Summarize this document'
                  : 'What does this workflow do?'}&quot;
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id} message={msg}>
              {/* Show retry buttons after the last assistant message when idle */}
              {msg.role === 'assistant'
                && !isProcessing
                && idx === messages.length - 1
                && msg.taskId
                && !msg.content.startsWith('Retrying as') && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <RotateCcw className="h-3 w-3" />
                    Not what you expected?
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1 px-2"
                      onClick={() => retryWithMode('question')}
                    >
                      <MessageSquare className="h-3 w-3" />
                      Retry as question
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1 px-2"
                      onClick={() => retryWithMode('edit')}
                    >
                      <Pencil className="h-3 w-3" />
                      Retry as edit
                    </Button>
                  </div>
                </div>
              )}
            </MessageBubble>
          ))}

          {isProcessing && (
            <div className="flex items-start gap-2">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm max-w-[85%]">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing your {contextLabel}...</span>
                </div>
                {activeTaskId && (
                  <a
                    href={`/tasks?taskId=${activeTaskId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
                  >
                    View task <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 flex-shrink-0">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input area */}
      <div className="border-t p-3 flex-shrink-0">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about or edit this ${contextLabel}...`}
            className="min-h-[60px] max-h-[120px] resize-none text-sm"
            disabled={isProcessing}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="self-end h-8 w-8 p-0"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}

function MessageBubble({ message, children }: { message: AiMessage; children?: React.ReactNode }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'rounded-lg px-3 py-2 text-sm max-w-[85%]',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <MarkdownContent content={message.content} />
          </div>
        )}
        {message.editSummary && (
          <div className="mt-1.5 pt-1.5 border-t border-border/50">
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              Changes applied
            </span>
          </div>
        )}
        {message.taskId && !isUser && (
          <a
            href={`/tasks?taskId=${message.taskId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            View task <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {children}
      </div>
    </div>
  )
}
