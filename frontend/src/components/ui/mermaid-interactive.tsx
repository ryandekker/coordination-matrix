'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface MermaidInteractiveProps {
  chart: string
  className?: string
  selectedNodeId?: string | null
  onNodeClick?: (nodeId: string) => void
  onAddBetween?: (afterNodeId: string) => void
  onError?: (error: string) => void
}

let mermaidInitialized = false

export function MermaidInteractive({
  chart,
  className = '',
  selectedNodeId,
  onNodeClick,
  onAddBetween,
  onError,
}: MermaidInteractiveProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const renderIdRef = useRef(0)

  const renderChart = useCallback(async (chartCode: string, renderId: number) => {
    if (!chartCode) {
      setSvg('')
      setIsLoading(false)
      return
    }

    try {
      const mermaid = (await import('mermaid')).default

      if (!mermaidInitialized) {
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

      const id = `mermaid-interactive-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const { svg: renderedSvg } = await mermaid.render(id, chartCode)

      if (renderId === renderIdRef.current) {
        setSvg(renderedSvg)
        setError(null)
        setIsLoading(false)
      }
    } catch (err) {
      if (renderId === renderIdRef.current) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to render diagram'
        setError(errorMessage)
        onError?.(errorMessage)
        setSvg('')
        setIsLoading(false)
      }
    }
  }, [onError])

  useEffect(() => {
    renderIdRef.current += 1
    const currentRenderId = renderIdRef.current

    setIsLoading(true)
    setError(null)

    const timeoutId = setTimeout(() => {
      renderChart(chart, currentRenderId)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [chart, renderChart])

  // Add click handlers to rendered nodes
  useEffect(() => {
    if (!containerRef.current || !svg) return

    const container = containerRef.current

    // Find all flowchart nodes (g elements with class 'node')
    const nodes = container.querySelectorAll('g.node')

    nodes.forEach((node) => {
      const nodeElement = node as SVGGElement
      const nodeId = nodeElement.id

      // Extract the step ID from the node ID (format: flowchart-stepId-123)
      const match = nodeId.match(/flowchart-([^-]+)-/)
      const stepId = match ? match[1] : nodeId

      // Make node clickable
      nodeElement.style.cursor = 'pointer'

      // Add hover effect
      const originalOpacity = nodeElement.style.opacity
      nodeElement.addEventListener('mouseenter', () => {
        nodeElement.style.opacity = '0.8'
      })
      nodeElement.addEventListener('mouseleave', () => {
        nodeElement.style.opacity = originalOpacity || '1'
      })

      // Handle click
      nodeElement.addEventListener('click', (e) => {
        e.stopPropagation()
        onNodeClick?.(stepId)
      })
    })

    // Highlight selected node
    if (selectedNodeId) {
      nodes.forEach((node) => {
        const nodeElement = node as SVGGElement
        const nodeId = nodeElement.id
        const match = nodeId.match(/flowchart-([^-]+)-/)
        const stepId = match ? match[1] : nodeId

        // Find the shape inside the node (rect, polygon, etc.)
        const shapes = nodeElement.querySelectorAll('rect, polygon, ellipse, circle, path')
        shapes.forEach((shape) => {
          const shapeElement = shape as SVGElement
          if (stepId === selectedNodeId) {
            // Add selection ring
            shapeElement.style.stroke = '#3b82f6'
            shapeElement.style.strokeWidth = '3'
            shapeElement.style.filter = 'drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))'
          }
        })
      })
    }

    // Add "+" buttons on edges for adding steps
    if (onAddBetween) {
      const edges = container.querySelectorAll('.edgePath')
      edges.forEach((edge) => {
        // Find the edge path to position the button
        const pathElement = edge.querySelector('path')
        if (!pathElement) return

        // Get the midpoint of the path
        const pathLength = pathElement.getTotalLength()
        const midPoint = pathElement.getPointAtLength(pathLength / 2)

        // Create add button
        const addButton = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        addButton.setAttribute('class', 'add-step-button')
        addButton.style.cursor = 'pointer'
        addButton.style.opacity = '0'
        addButton.style.transition = 'opacity 0.2s'

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', String(midPoint.x))
        circle.setAttribute('cy', String(midPoint.y))
        circle.setAttribute('r', '10')
        circle.setAttribute('fill', '#10b981')
        circle.setAttribute('stroke', 'white')
        circle.setAttribute('stroke-width', '2')

        const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        plus.setAttribute('x', String(midPoint.x))
        plus.setAttribute('y', String(midPoint.y + 4))
        plus.setAttribute('text-anchor', 'middle')
        plus.setAttribute('fill', 'white')
        plus.setAttribute('font-size', '14')
        plus.setAttribute('font-weight', 'bold')
        plus.textContent = '+'

        addButton.appendChild(circle)
        addButton.appendChild(plus)

        // Show on hover over the edge area
        const hoverArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        hoverArea.setAttribute('cx', String(midPoint.x))
        hoverArea.setAttribute('cy', String(midPoint.y))
        hoverArea.setAttribute('r', '20')
        hoverArea.setAttribute('fill', 'transparent')

        hoverArea.addEventListener('mouseenter', () => {
          addButton.style.opacity = '1'
        })
        hoverArea.addEventListener('mouseleave', () => {
          addButton.style.opacity = '0'
        })
        addButton.addEventListener('mouseenter', () => {
          addButton.style.opacity = '1'
        })
        addButton.addEventListener('mouseleave', () => {
          addButton.style.opacity = '0'
        })

        // Get source node ID from edge
        const edgeClass = edge.getAttribute('class') || ''
        const sourceMatch = edgeClass.match(/LS-([^\s]+)/)
        if (sourceMatch) {
          const sourceId = sourceMatch[1]
          addButton.addEventListener('click', (e) => {
            e.stopPropagation()
            onAddBetween(sourceId)
          })
        }

        edge.appendChild(hoverArea)
        edge.appendChild(addButton)
      })
    }
  }, [svg, selectedNodeId, onNodeClick, onAddBetween])

  if (error) {
    return (
      <div className={cn('p-4 bg-red-50 border border-red-200 rounded-lg', className)}>
        <p className="text-sm text-red-600 font-medium">Diagram Error</p>
        <p className="text-xs text-red-500 mt-1 font-mono whitespace-pre-wrap">{error}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-muted-foreground', className)}>
        <p>No diagram to display</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'mermaid-interactive overflow-auto flex items-center justify-center',
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
