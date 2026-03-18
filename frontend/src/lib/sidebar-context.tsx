'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { useIsMobile } from '@/hooks/use-media-query'

const STORAGE_KEY = 'sidebar.collapsed'

interface SidebarContextType {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isMobile: boolean
  collapsed: boolean
  toggleCollapsed: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  isOpen: false,
  setIsOpen: () => {},
  isMobile: false,
  collapsed: false,
  toggleCollapsed: () => {},
})

/** Read initial collapsed state synchronously from localStorage + matchMedia */
function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false // SSR: default expanded
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved !== null) return saved === 'true'
  // No saved preference — collapsed on tablet, expanded on desktop
  return !window.matchMedia('(min-width: 1024px)').matches
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const isMobile = useIsMobile()
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(getInitialCollapsed)

  // Auto-close sidebar on route change (mobile only)
  useEffect(() => {
    if (isMobile) {
      setIsOpen(false)
    }
  }, [pathname, isMobile])

  const handleSetIsOpen = useCallback((open: boolean) => {
    setIsOpen(open)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen: handleSetIsOpen, isMobile, collapsed, toggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
