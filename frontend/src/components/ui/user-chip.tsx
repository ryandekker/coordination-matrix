'use client'

import { Bot, User as UserIcon, Cog } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSystemUser } from '@/lib/api'
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
    chip: 'h-5 px-1.5 gap-1 text-xs max-w-[200px]',
    avatar: 'w-3.5 h-3.5',
    avatarText: 'text-[8px]',
    icon: 'h-2.5 w-2.5',
  },
  md: {
    chip: 'h-6 px-2 gap-1.5 text-xs max-w-[220px]',
    avatar: 'w-4 h-4',
    avatarText: 'text-[10px]',
    icon: 'h-3 w-3',
  },
  lg: {
    chip: 'h-7 px-2.5 gap-2 text-sm max-w-[240px]',
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

  // System user - show cog icon with gray color
  if (isSystemUser(user)) {
    const systemColor = user.botColor || '#6B7280' // Default to gray
    return (
      <span
        className={cn(
          'rounded-full flex items-center justify-center flex-shrink-0',
          styles.avatar,
          className
        )}
        style={{
          backgroundColor: `${systemColor}20`,
          color: systemColor,
        }}
      >
        <Cog className={styles.icon} />
      </span>
    )
  }

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
      <div
        className={cn(
          'inline-flex items-center rounded-full bg-muted text-muted-foreground',
          styles.chip,
          className
        )}
      >
        <UserIcon className={cn(styles.icon, 'opacity-50')} />
        {!avatarOnly && 'Unassigned'}
      </div>
    )
  }

  if (avatarOnly) {
    return <UserAvatar user={user} size={size} className={className} />
  }

  // System user chip styling
  if (isSystemUser(user)) {
    const systemColor = user.botColor || '#6B7280' // Gray
    return (
      <div
        className={cn(
          'inline-flex items-center rounded-full font-medium whitespace-nowrap',
          styles.chip,
          className
        )}
        style={{
          backgroundColor: `${systemColor}15`,
          color: systemColor,
          borderWidth: '1px',
          borderColor: `${systemColor}30`,
        }}
        title={`${user.displayName} (automated)`}
      >
        <UserAvatar user={user} size={size} />
        <span className="truncate">{user.displayName}</span>
      </div>
    )
  }

  // Bot user chip styling
  if (user.isAgent) {
    const botColor = user.botColor || '#6366f1'
    return (
      <div
        className={cn(
          'inline-flex items-center rounded-full font-medium whitespace-nowrap',
          styles.chip,
          className
        )}
        style={{
          backgroundColor: `${botColor}15`,
          color: botColor,
          borderWidth: '1px',
          borderColor: `${botColor}30`,
        }}
        title={user.displayName}
      >
        <UserAvatar user={user} size={size} />
        <span className="truncate">{user.displayName}</span>
      </div>
    )
  }

  // Human user chip styling
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full bg-secondary/50 border border-border/50 whitespace-nowrap',
        styles.chip,
        className
      )}
      title={user.displayName}
    >
      <UserAvatar user={user} size={size} />
      <span className="truncate">{user.displayName}</span>
    </div>
  )
}

export { UserAvatar }