'use client'

import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])

  return matches
}

/** Below md breakpoint (< 768px) */
export function useIsMobile() {
  return !useMediaQuery('(min-width: 768px)')
}

/** md to lg breakpoint (768px - 1023px) */
export function useIsTablet() {
  const isAboveMobile = useMediaQuery('(min-width: 768px)')
  const isBelowDesktop = !useMediaQuery('(min-width: 1024px)')
  return isAboveMobile && isBelowDesktop
}

/** Above lg breakpoint (>= 1024px) */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)')
}
