'use client'

import { useState, useRef, useCallback } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface TouchTooltipProps {
  label: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Long-press tooltip for touch devices. Shows a label popover after
 * holding for 500ms, auto-dismisses after 1.5s. Normal taps pass through
 * unaffected. On desktop, the child's title/aria-label still works.
 */
export function TouchTooltip({ label, children, side = 'top' }: TouchTooltipProps) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTouchStart = useCallback(() => {
    timerRef.current = setTimeout(() => {
      setOpen(true)
      // Auto-dismiss after 1.5s
      setTimeout(() => setOpen(false), 1500)
    }, 500)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          className="inline-flex"
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        className="w-auto px-3 py-1.5 text-sm pointer-events-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {label}
      </PopoverContent>
    </Popover>
  )
}
