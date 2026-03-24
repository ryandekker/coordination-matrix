'use client'

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidInteractive } from './mermaid-interactive'
import { cn } from '@/lib/utils'

interface MarkdownContentProps {
  content: string
  className?: string
}

/**
 * Renders markdown with support for mermaid diagrams.
 * Mermaid code blocks (```mermaid) are rendered as interactive diagrams.
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const components = useMemo(() => ({
    // Custom renderer for code blocks - renders mermaid diagrams
    code: ({ className: codeClassName, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
      const match = /language-(\w+)/.exec(codeClassName || '')
      const language = match ? match[1] : null
      const codeContent = String(children).replace(/\n$/, '')

      // Render mermaid code blocks as diagrams
      if (language === 'mermaid') {
        return (
          <MermaidInteractive
            chart={codeContent}
            className="my-4 border rounded-lg p-2 bg-muted/20"
          />
        )
      }

      // Inline code (no language)
      if (!language) {
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        )
      }

      // Block code with language
      return (
        <pre className="overflow-auto">
          <code className={codeClassName} {...props}>
            {children}
          </code>
        </pre>
      )
    },
    // Prevent double-wrapping of pre blocks
    pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
  }), [])

  return (
    <article className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
