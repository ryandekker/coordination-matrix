'use client'

import { Bot, User as UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { User } from '@/lib/api'

export interface UserChipProps {
  user: User | null | undefined
  /** Show only the avatar without the name */
  avatarOnly?: boolean
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Additional className */
  className?: string
  /** Show "Unassigned" when no user */
  showUnassigned?: boolean
}

const sizeStyles = {
  sm: {
    chip: 'h-5 px-1.5 gap-1 text-xs',
    avatar: 'w-3.5 h-3.5',
    avatarText: 'text-[8px]',
    icon: 'h-2.5 w-2.5',
  },
  md: {
    chip: 'h-6 px-2 gap-1.5 text-xs',
    avatar: 'w-4 h-4',
    avatarText: 'text-[10px]',
    icon: 'h-3 w-3',
  },
  lg: {
    chip: 'h-7 px-2.5 gap-2 text-sm',
    avatar: 'w-5 h-5',
    avatarText: 'text-xs',
    icon: 'h-3.5 w-3.5',
  },
}

function UserAvatar({
  user,
  size = 'md',
  className
}: {
  user: User
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const styles = sizeStyles[size]

  if (user.isAgent) {
    // Bot user - show bot icon with optional custom color
    const botColor = user.botColor || '#6366f1' // Default to indigo
    return (
      <span
        className={cn(
          'rounded-full flex items-center justify-center flex-shrink-0',
          styles.avatar,
          className
        )}
        style={{
          backgroundColor: `${botColor}20`,
          color: botColor,
        }}
      >
        <Bot className={styles.icon} />
      </span>
    )
  }

  // Human user - show profile picture or initials
  if (user.profilePicture) {
    return (
      <img
        src={user.profilePicture}
        alt={user.displayName}
        className={cn(
          'rounded-full object-cover flex-shrink-0',
          styles.avatar,
          className
        )}
      />
    )
  }

  // Fallback to initials
  return (
    <span
      className={cn(
        'rounded-full bg-primary/20 flex items-center justify-center font-medium flex-shrink-0',
        styles.avatar,
        styles.avatarText,
        className
      )}
    >
      {user.displayName.charAt(0).toUpperCase()}
    </span>
  )
}

export function UserChip({
  user,
  avatarOnly = false,
  size = 'md',
  className,
  showUnassigned = true,
}: UserChipProps) {
  const styles = sizeStyles[size]

  if (!user) {
    if (!showUnassigned) return null
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full bg-muted text-muted-foreground',
          styles.chip,
          className
        )}
      >
        <UserIcon className={cn(styles.icon, 'opacity-50')} />
        {!avatarOnly && 'Unassigned'}
      </span>
    )
  }

  if (avatarOnly) {
    return <UserAvatar user={user} size={size} className={className} />
  }

  // Bot user chip styling
  if (user.isAgent) {
    const botColor = user.botColor || '#6366f1'
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-medium',
          styles.chip,
          className
        )}
        style={{
          backgroundColor: `${botColor}15`,
          color: botColor,
          borderWidth: '1px',
          borderColor: `${botColor}30`,
        }}
      >
        <UserAvatar user={user} size={size} />
        {user.displayName}
      </span>
    )
  }

  // Human user chip styling
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-secondary/50 border border-border/50',
        styles.chip,
        className
      )}
    >
      <UserAvatar user={user} size={size} />
      {user.displayName}
    </span>
  )
}

export { UserAvatar }