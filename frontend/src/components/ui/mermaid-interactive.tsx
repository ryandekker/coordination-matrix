'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface MermaidInteractiveProps {
  chart: string
  className?: string
  selectedNodeId?: string | null
  stepIds?: string[]  // List of step IDs in order for edge buttons
  onNodeClick?: (nodeId: string) => void
  onAddAfter?: (stepId: string) => void
  onError?: (error: string) => void
}

let mermaidInitialized = false

export function MermaidInteractive({
  chart,
  className = '',
  selectedNodeId,
  stepIds = [],
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

    // Add "+" buttons on edges between consecutive nodes
    if (onAddAfter && stepIds.length > 1) {
      const svgElement = container.querySelector('svg')
      if (!svgElement) return

      // Get positions of all nodes to place + buttons between them
      const nodePositions: { stepId: string; x: number; y: number; height: number }[] = []

      stepIds.forEach(stepId => {
        // Find the node element for this step
        const nodeEl = container.querySelector(`[id*="${stepId}"]`)
        if (nodeEl) {
          const bbox = (nodeEl as SVGGraphicsElement).getBBox?.()
          if (bbox) {
            nodePositions.push({
              stepId,
              x: bbox.x + bbox.width / 2,
              y: bbox.y + bbox.height,
              height: bbox.height
            })
          }
        }
      })

      // Add a + button between each consecutive pair of nodes
      for (let i = 0; i < nodePositions.length - 1; i++) {
        const current = nodePositions[i]
        const next = nodePositions[i + 1]

        // Position the button between the two nodes
        const midX = (current.x + next.x) / 2
        const midY = (current.y + next.y - next.height) / 2

        // Create the add button group
        const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        buttonGroup.setAttribute('class', 'add-step-btn')
        buttonGroup.style.cursor = 'pointer'
        buttonGroup.style.opacity = '0.3'
        buttonGroup.style.transition = 'opacity 0.15s'

        // Circle background
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', String(midX))
        circle.setAttribute('cy', String(midY))
        circle.setAttribute('r', '10')
        circle.setAttribute('fill', '#10b981')
        circle.setAttribute('stroke', 'white')
        circle.setAttribute('stroke-width', '2')

        // Plus sign
        const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        plus.setAttribute('x', String(midX))
        plus.setAttribute('y', String(midY + 4))
        plus.setAttribute('text-anchor', 'middle')
        plus.setAttribute('fill', 'white')
        plus.setAttribute('font-size', '14')
        plus.setAttribute('font-weight', 'bold')
        plus.setAttribute('style', 'pointer-events: none')
        plus.textContent = '+'

        buttonGroup.appendChild(circle)
        buttonGroup.appendChild(plus)

        // Hover area
        const hoverArea = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        hoverArea.setAttribute('cx', String(midX))
        hoverArea.setAttribute('cy', String(midY))
        hoverArea.setAttribute('r', '18')
        hoverArea.setAttribute('fill', 'transparent')
        hoverArea.style.cursor = 'pointer'

        const sourceStepId = current.stepId

        hoverArea.addEventListener('mouseenter', () => {
          buttonGroup.style.opacity = '1'
        })
        hoverArea.addEventListener('mouseleave', () => {
          buttonGroup.style.opacity = '0.3'
        })

        hoverArea.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          onAddAfter(sourceStepId)
        })

        svgElement.appendChild(hoverArea)
        svgElement.appendChild(buttonGroup)
      }
    }
  }, [svg, selectedNodeId, stepIds, onNodeClick, onAddAfter])

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
