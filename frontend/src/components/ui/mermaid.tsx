'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface MermaidProps {
  chart: string
  className?: string
  onError?: (error: string) => void
}

// Track initialization per theme to allow re-init on theme change
let currentMermaidTheme: string | null = null

export function Mermaid({ chart, className = '', onError }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const renderIdRef = useRef(0)

  // Detect dark mode
  const getTheme = useCallback(() => {
    if (typeof window === 'undefined') return 'default'
    return document.documentElement.classList.contains('dark') ? 'dark' : 'default'
  }, [])

  const renderChart = useCallback(async (chartCode: string, renderId: number) => {
    if (!chartCode) {
      setSvg('')
      setIsLoading(false)
      return
    }

    try {
      // Dynamically import mermaid only on client side
      const mermaid = (await import('mermaid')).default

      const theme = getTheme()

      // Re-initialize if theme changed
      if (currentMermaidTheme !== theme) {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme,
          securityLevel: 'loose',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
        })
        currentMermaidTheme = theme
      }

      // Generate a unique ID for this render
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // Parse and render the chart
      const { svg: renderedSvg } = await mermaid.render(id, chartCode)

      // Only update if this is still the current render
      if (renderId === renderIdRef.current) {
        setSvg(renderedSvg)
        setError(null)
        setIsLoading(false)
      }
    } catch (err) {
      // Only update if this is still the current render
      if (renderId === renderIdRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
        setError(errorMessage)
        onError?.(errorMessage)
        setSvg('')
        setIsLoading(false)
      }
    }
  }, [onError, getTheme])

  useEffect(() => {
    // Increment render ID to cancel any pending renders
    renderIdRef.current += 1
    const currentRenderId = renderIdRef.current

    setIsLoading(true)
    setError(null)

    // Debounce the render to avoid too many re-renders while typing
    const timeoutId = setTimeout(() => {
      renderChart(chart, currentRenderId)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [chart, renderChart])

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          // Theme changed, force re-render
          renderIdRef.current += 1
          renderChart(chart, renderIdRef.current)
        }
      })
    })

    observer.observe(document.documentElement, { attributes: true })

    return () => observer.disconnect()
  }, [chart, renderChart])

  if (error) {
    return (
      <div className={`p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg ${className}`}>
        <p className="text-sm text-red-600 dark:text-red-400 font-medium">Diagram Error</p>
        <p className="text-xs text-red-500 dark:text-red-400 mt-1 font-mono whitespace-pre-wrap">{error}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div className={`flex items-center justify-center p-8 text-muted-foreground ${className}`}>
        <p>No diagram to display</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`mermaid-container overflow-auto flex items-center justify-center ${className}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
