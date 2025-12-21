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

      // Find actual edge paths and position buttons on them
      const edgePaths = container.querySelectorAll('.edgePath path, path.flowchart-link')

      // Build a map of step IDs to their indices
      const stepIdToIndex = new Map<string, number>()
      stepIds.forEach((id, idx) => stepIdToIndex.set(id, idx))

      edgePaths.forEach((pathEl) => {
        const pathElement = pathEl as SVGPathElement
        try {
          const pathLength = pathElement.getTotalLength()
          if (pathLength < 20) return // Skip very short paths

          const midPoint = pathElement.getPointAtLength(pathLength / 2)

          // Try to determine which step this edge comes from
          // Look at the parent's class for LS-{stepId} pattern
          const parent = pathElement.closest('.edgePath')
          let sourceStepId: string | null = null

          if (parent) {
            const classList = parent.getAttribute('class') || ''
            // Try to match LS-{stepId} pattern
            const sourceMatch = classList.match(/LS-([^\s]+)/)
            if (sourceMatch) {
              sourceStepId = sourceMatch[1]
            }
          }

          // If we couldn't find source from class, use position-based detection
          if (!sourceStepId) {
            // Find the closest step node above this path's start point
            const startPoint = pathElement.getPointAtLength(0)
            let closestStepId: string | null = null
            let closestDist = Infinity

            stepIds.forEach(stepId => {
              const nodeEl = container.querySelector(`[id*="${stepId}"]`)
              if (nodeEl) {
                const bbox = (nodeEl as SVGGraphicsElement).getBBox?.()
                if (bbox) {
                  const nodeCenterX = bbox.x + bbox.width / 2
                  const nodeBottomY = bbox.y + bbox.height
                  const dist = Math.hypot(startPoint.x - nodeCenterX, startPoint.y - nodeBottomY)
                  if (dist < closestDist && dist < 100) {
                    closestDist = dist
                    closestStepId = stepId
                  }
                }
              }
            })
            sourceStepId = closestStepId
          }

          if (!sourceStepId) return

          // Detect dark mode
          const isDark = document.documentElement.classList.contains('dark')
          // Default: bg-muted (fully opaque)
          const defaultBg = isDark ? '#27272a' : '#f4f4f5'  // zinc-800 : zinc-100
          const borderColor = isDark ? '#3f3f46' : '#e5e5e5'  // zinc-700 : neutral-200
          // Hover: white background
          const hoverBg = isDark ? '#fafafa' : '#ffffff'  // neutral-50 : white
          // Plus icon colors
          const defaultPlusColor = isDark ? '#a1a1aa' : '#71717a'  // zinc-400 : zinc-500 (gray)
          const hoverPlusColor = '#1e40af'  // blue-800 (dark blue)

          // Create minimal plus button - background matches page, plus is accent color
          const buttonGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          buttonGroup.setAttribute('class', 'add-step-btn')
          buttonGroup.style.cursor = 'pointer'
          buttonGroup.style.transition = 'all 0.15s ease'

          // Background circle - semi-transparent muted by default
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          circle.setAttribute('cx', String(midPoint.x))
          circle.setAttribute('cy', String(midPoint.y))
          circle.setAttribute('r', '10')
          circle.setAttribute('fill', defaultBg)
          circle.setAttribute('stroke', borderColor)
          circle.setAttribute('stroke-width', '1')
          circle.style.transition = 'all 0.15s ease'

          // Plus icon - gray by default
          const plusGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          plusGroup.setAttribute('stroke', defaultPlusColor)
          plusGroup.setAttribute('stroke-width', '2')
          plusGroup.setAttribute('stroke-linecap', 'round')
          plusGroup.style.transition = 'all 0.15s ease'

          const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          hLine.setAttribute('x1', String(midPoint.x - 4))
          hLine.setAttribute('y1', String(midPoint.y))
          hLine.setAttribute('x2', String(midPoint.x + 4))
          hLine.setAttribute('y2', String(midPoint.y))

          const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          vLine.setAttribute('x1', String(midPoint.x))
          vLine.setAttribute('y1', String(midPoint.y - 4))
          vLine.setAttribute('x2', String(midPoint.x))
          vLine.setAttribute('y2', String(midPoint.y + 4))

          plusGroup.appendChild(hLine)
          plusGroup.appendChild(vLine)

          buttonGroup.appendChild(circle)
          buttonGroup.appendChild(plusGroup)

          // Hover handlers on the button group itself
          buttonGroup.addEventListener('mouseenter', () => {
            circle.setAttribute('fill', hoverBg)
            circle.setAttribute('stroke', hoverPlusColor)
            plusGroup.setAttribute('stroke', hoverPlusColor)
          })
          buttonGroup.addEventListener('mouseleave', () => {
            circle.setAttribute('fill', defaultBg)
            circle.setAttribute('stroke', borderColor)
            plusGroup.setAttribute('stroke', defaultPlusColor)
          })

          buttonGroup.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            onAddAfter(sourceStepId!)
          })

          svgElement.appendChild(buttonGroup)
        } catch {
          // getTotalLength might fail on some paths
        }
      })
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
