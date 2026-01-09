import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cn, formatDate, formatDateTime, formatRelativeTime } from './utils'

describe('cn (className utility)', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    expect(cn('base', true && 'active')).toBe('base active')
    expect(cn('base', false && 'inactive')).toBe('base')
  })

  it('should merge tailwind classes correctly', () => {
    // tailwind-merge handles conflicting classes
    expect(cn('p-4', 'p-2')).toBe('p-2')
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500')
  })

  it('should handle arrays of classes', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('should handle objects with conditional classes', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz')
  })

  it('should handle undefined and null values', () => {
    expect(cn('foo', undefined, 'bar', null)).toBe('foo bar')
  })

  it('should handle empty strings', () => {
    expect(cn('foo', '', 'bar')).toBe('foo bar')
  })

  it('should return empty string for no arguments', () => {
    expect(cn()).toBe('')
  })
})

describe('formatDate', () => {
  it('should format a valid date string', () => {
    const result = formatDate('2024-01-15T10:30:00Z')
    expect(result).toMatch(/Jan\s+15,?\s*2024/)
  })

  it('should format a Date object', () => {
    const date = new Date('2024-06-20T12:00:00Z')
    const result = formatDate(date)
    expect(result).toMatch(/Jun\s+20,?\s*2024/)
  })

  it('should return dash for null', () => {
    expect(formatDate(null)).toBe('-')
  })

  it('should return dash for undefined', () => {
    expect(formatDate(undefined)).toBe('-')
  })

  it('should handle different months', () => {
    // Use full ISO strings with time to avoid timezone issues
    expect(formatDate('2024-03-15T12:00:00Z')).toMatch(/Mar/)
    expect(formatDate('2024-12-25T12:00:00Z')).toMatch(/Dec/)
  })
})

describe('formatDateTime', () => {
  it('should format date with time', () => {
    // Use a specific date that we can verify
    const result = formatDateTime('2024-01-15T14:30:00Z')
    expect(result).toMatch(/Jan\s+15,?\s*2024/)
    // Should include time portion
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })

  it('should format a Date object with time', () => {
    const date = new Date('2024-06-20T09:45:00Z')
    const result = formatDateTime(date)
    expect(result).toMatch(/Jun\s+20,?\s*2024/)
  })

  it('should return dash for null', () => {
    expect(formatDateTime(null)).toBe('-')
  })

  it('should return dash for undefined', () => {
    expect(formatDateTime(undefined)).toBe('-')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    // Mock Date.now to have consistent test results
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return "just now" for very recent times', () => {
    const now = new Date()
    const result = formatRelativeTime(now.toISOString())
    expect(result).toBe('just now')
  })

  it('should return minutes ago for times under an hour', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const result = formatRelativeTime(fiveMinutesAgo.toISOString())
    expect(result).toBe('5m ago')
  })

  it('should return hours ago for times under a day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const result = formatRelativeTime(threeHoursAgo.toISOString())
    expect(result).toBe('3h ago')
  })

  it('should return days ago for times under a week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    const result = formatRelativeTime(twoDaysAgo.toISOString())
    expect(result).toBe('2d ago')
  })

  it('should return formatted date for times over a week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const result = formatRelativeTime(twoWeeksAgo.toISOString())
    // Should fall back to formatDate
    expect(result).toMatch(/Jan\s+\d+,?\s*2024/)
  })

  it('should handle Date objects', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const result = formatRelativeTime(oneHourAgo)
    expect(result).toBe('1h ago')
  })

  it('should return dash for null', () => {
    expect(formatRelativeTime(null)).toBe('-')
  })

  it('should return dash for undefined', () => {
    expect(formatRelativeTime(undefined)).toBe('-')
  })

  it('should handle edge case of 59 minutes', () => {
    const fiftyNineMinutesAgo = new Date(Date.now() - 59 * 60 * 1000)
    const result = formatRelativeTime(fiftyNineMinutesAgo.toISOString())
    expect(result).toBe('59m ago')
  })

  it('should handle edge case of 23 hours', () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000)
    const result = formatRelativeTime(twentyThreeHoursAgo.toISOString())
    expect(result).toBe('23h ago')
  })

  it('should handle edge case of 6 days', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    const result = formatRelativeTime(sixDaysAgo.toISOString())
    expect(result).toBe('6d ago')
  })
})
