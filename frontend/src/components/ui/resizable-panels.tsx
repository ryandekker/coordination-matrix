'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { GripVertical } from 'lucide-react'

interface ResizablePanelsProps {
  children: [React.ReactNode, React.ReactNode]
  defaultLeftWidth?: number // percentage (0-100)
  minLeftWidth?: number // percentage
  maxLeftWidth?: number // percentage
  className?: string
  leftClassName?: string
  rightClassName?: string
  onResize?: (leftWidth: number) => void
}

export function ResizablePanels({
  children,
  defaultLeftWidth = 60,
  minLeftWidth = 20,
  maxLeftWidth = 80,
  className,
  leftClassName,
  rightClassName,
  onResize,
}: ResizablePanelsProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = React.useState(defaultLeftWidth)
  const [isDragging, setIsDragging] = React.useState(false)

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  React.useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percentage = (x / rect.width) * 100

      const clampedWidth = Math.min(Math.max(percentage, minLeftWidth), maxLeftWidth)
      setLeftWidth(clampedWidth)
      onResize?.(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, minLeftWidth, maxLeftWidth, onResize])

  // Prevent text selection while dragging
  React.useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
    } else {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDragging])

  const [leftChild, rightChild] = children

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full', className)}
    >
      {/* Left Panel */}
      <div
        className={cn('overflow-hidden', leftClassName)}
        style={{ width: `${leftWidth}%` }}
      >
        {leftChild}
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          'relative flex-shrink-0 w-2 cursor-col-resize group',
          'flex items-center justify-center',
          isDragging && 'bg-primary/10'
        )}
        onMouseDown={handleMouseDown}
      >
        {/* Visual handle indicator */}
        <div
          className={cn(
            'absolute inset-y-0 w-1 rounded-full transition-colors',
            'bg-border group-hover:bg-primary/50',
            isDragging && 'bg-primary'
          )}
        />
        {/* Grip icon in the center */}
        <div
          className={cn(
            'absolute z-10 p-0.5 rounded bg-muted border shadow-sm',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            isDragging && 'opacity-100'
          )}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Right Panel */}
      <div
        className={cn('flex-1 overflow-hidden', rightClassName)}
      >
        {rightChild}
      </div>
    </div>
  )
}
