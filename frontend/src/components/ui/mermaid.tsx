'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'

interface MermaidProps {
  chart: string
  className?: string
  onError?: (error: string) => void
}

// Track if mermaid has been initialized
let mermaidInitialized = false

function initializeMermaid() {
  if (mermaidInitialized) return

  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
    },
  })
  mermaidInitialized = true
}

export function Mermaid({ chart, className = '', onError }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const renderIdRef = useRef(0)

  const renderChart = useCallback(async (chartContent: string, renderId: number) => {
    if (!chartContent?.trim()) {
      setSvg('')
      setError(null)
      setIsRendering(false)
      return
    }

    try {
      initializeMermaid()

      // Generate a unique ID for this render
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // Clear previous error
      setError(null)
      setIsRendering(true)

      // Parse and render the chart
      const { svg: renderedSvg } = await mermaid.render(id, chartContent)

      // Only update if this is still the current render
      if (renderId === renderIdRef.current) {
        setSvg(renderedSvg)
        setIsRendering(false)
      }
    } catch (err) {
      // Only update if this is still the current render
      if (renderId === renderIdRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
        setError(errorMessage)
        onError?.(errorMessage)
        setSvg('')
        setIsRendering(false)
      }
    }
  }, [onError])

  useEffect(() => {
    // Increment render ID to invalidate any pending renders
    renderIdRef.current += 1
    const currentRenderId = renderIdRef.current

    // Small delay to debounce rapid changes
    const timeoutId = setTimeout(() => {
      renderChart(chart, currentRenderId)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [chart, renderChart])

  if (error) {
    return (
      <div className={`p-4 bg-red-50 border border-red-200 rounded-lg ${className}`}>
        <p className="text-sm text-red-600 font-medium">Diagram Error</p>
        <p className="text-xs text-red-500 mt-1 font-mono whitespace-pre-wrap">{error}</p>
      </div>
    )
  }

  // Show placeholder if no chart content
  if (!chart?.trim()) {
    return (
      <div className={`flex items-center justify-center p-8 text-muted-foreground ${className}`}>
        <p>Enter a Mermaid diagram to preview</p>
      </div>
    )
  }

  // Show loading state only briefly during initial render
  if (isRendering && !svg) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // If we have SVG, render it (even if also rendering - for smooth transitions)
  if (svg) {
    return (
      <div
        ref={containerRef}
        className={`mermaid-container ${className} ${isRendering ? 'opacity-50' : ''}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  // Fallback - should rarely hit this
  return (
    <div className={`flex items-center justify-center p-8 ${className}`}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}
