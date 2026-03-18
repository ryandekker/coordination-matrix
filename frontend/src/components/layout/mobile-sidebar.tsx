'use client'

import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/lib/sidebar-context'
import { Sidebar } from './sidebar'

export function MobileSidebar() {
  const { isOpen, setIsOpen } = useSidebar()

  return (
    <DrawerPrimitive.Root
      direction="left"
      open={isOpen}
      onOpenChange={setIsOpen}
      shouldScaleBackground={false}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <DrawerPrimitive.Content
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-[280px] bg-background shadow-xl',
            'focus:outline-none'
          )}
        >
          <DrawerPrimitive.Title className="sr-only">Navigation</DrawerPrimitive.Title>
          <Sidebar onNavigate={() => setIsOpen(false)} />
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}
