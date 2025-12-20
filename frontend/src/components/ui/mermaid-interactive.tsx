'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface MermaidInteractiveProps {
  chart: string
  className?: string
  selectedNodeId?: string | null
  onNodeClick?: (nodeId: string) => void
  onAddAfter?: (stepId: string) => void
  onError?: (error: string) => void
}

let mermaidInitialized = false

export function MermaidInteractive({
  chart,
  className = '',
  selectedNodeId,
  onNodeClick,
  onAddAfter,
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

      // Extract the step ID from the node ID
      // Mermaid format: flowchart-{stepId}-{number}
      // stepId can contain dashes, so we need to extract everything between first "flowchart-" and last "-number"
      let stepId = nodeId
      if (nodeId.startsWith('flowchart-')) {
        // Remove "flowchart-" prefix and the trailing "-number"
        const withoutPrefix = nodeId.slice('flowchart-'.length)
        const lastDashIdx = withoutPrefix.lastIndexOf('-')
        if (lastDashIdx > 0) {
          stepId = withoutPrefix.slice(0, lastDashIdx)
        }
      }

      // Make node clickable
      nodeElement.style.cursor = 'pointer'

      // Clone and replace to remove old event listeners
      const newNode = nodeElement.cloneNode(true) as SVGGElement
      nodeElement.parentNode?.replaceChild(newNode, nodeElement)

      // Add hover effect
      newNode.addEventListener('mouseenter', () => {
        newNode.style.opacity = '0.8'
      })
      newNode.addEventListener('mouseleave', () => {
        newNode.style.opacity = '1'
      })

      // Handle click
      newNode.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        onNodeClick?.(stepId)
      })

      // Highlight selected node
      if (stepId === selectedNodeId) {
        const shapes = newNode.querySelectorAll('rect, polygon, ellipse, circle, path.basic')
        shapes.forEach((shape) => {
          const shapeElement = shape as SVGElement
          shapeElement.style.stroke = '#3b82f6'
          shapeElement.style.strokeWidth = '3'
          shapeElement.style.filter = 'drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))'
        })
      }
    })

    // Add "+" buttons on edges for adding steps between nodes
    if (onAddAfter) {
      const svgElement = container.querySelector('svg')
      if (!svgElement) return

      // Find all edge paths
      const edgePaths = container.querySelectorAll('.edgePath')

      edgePaths.forEach((edgePath) => {
        const pathElement = edgePath.querySelector('path')
        if (!pathElement) return

        // Get the source node ID from the edge class
        // Mermaid uses classes like "LS-step-123456789 LE-step-987654321"
        const classList = edgePath.getAttribute('class') || ''
        const sourceMatch = classList.match(/LS-([^\s]+)/)
        if (!sourceMatch) return

        const sourceStepId = sourceMatch[1]

        // Get midpoint of the path
        try {
          const pathLength = pathElement.getTotalLength()
          const midPoint = pathElement.getPointAtLength(pathLength / 2)

          // Create the add button group
          const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          buttonGroup.setAttribute('class', 'add-step-btn')
          buttonGroup.style.cursor = 'pointer'
          buttonGroup.style.opacity = '0'
          buttonGroup.style.transition = 'opacity 0.15s'

          // Circle background
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          circle.setAttribute('cx', String(midPoint.x))
          circle.setAttribute('cy', String(midPoint.y))
          circle.setAttribute('r', '10')
          circle.setAttribute('fill', '#10b981')
          circle.setAttribute('stroke', 'white')
          circle.setAttribute('stroke-width', '2')

          // Plus sign
          const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          plus.setAttribute('x', String(midPoint.x))
          plus.setAttribute('y', String(midPoint.y + 4))
          plus.setAttribute('text-anchor', 'middle')
          plus.setAttribute('fill', 'white')
          plus.setAttribute('font-size', '14')
          plus.setAttribute('font-weight', 'bold')
          plus.setAttribute('style', 'pointer-events: none')
          plus.textContent = '+'

          buttonGroup.appendChild(circle)
          buttonGroup.appendChild(plus)

          // Hover area (larger invisible circle for easier hovering)
          const hoverArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          hoverArea.setAttribute('cx', String(midPoint.x))
          hoverArea.setAttribute('cy', String(midPoint.y))
          hoverArea.setAttribute('r', '18')
          hoverArea.setAttribute('fill', 'transparent')
          hoverArea.style.cursor = 'pointer'

          // Show button on hover
          hoverArea.addEventListener('mouseenter', () => {
            buttonGroup.style.opacity = '1'
          })
          hoverArea.addEventListener('mouseleave', () => {
            buttonGroup.style.opacity = '0'
          })

          // Handle click
          hoverArea.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            onAddAfter(sourceStepId)
          })

          // Add to SVG
          svgElement.appendChild(hoverArea)
          svgElement.appendChild(buttonGroup)
        } catch {
          // getTotalLength might fail on some paths
        }
      })
    }
  }, [svg, selectedNodeId, onNodeClick, onAddAfter])

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
        'mermaid-interactive flex items-center justify-center',
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
