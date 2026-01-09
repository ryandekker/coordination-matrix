import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

describe('Badge', () => {
  it('should render badge with children', () => {
    render(<Badge>Test Badge</Badge>)
    expect(screen.getByText('Test Badge')).toBeInTheDocument()
  })

  it('should apply default variant styles', () => {
    render(<Badge>Default</Badge>)
    const badge = screen.getByText('Default')
    expect(badge).toHaveClass('bg-primary')
  })

  it('should apply secondary variant styles', () => {
    render(<Badge variant="secondary">Secondary</Badge>)
    const badge = screen.getByText('Secondary')
    expect(badge).toHaveClass('bg-secondary')
  })

  it('should apply destructive variant styles', () => {
    render(<Badge variant="destructive">Destructive</Badge>)
    const badge = screen.getByText('Destructive')
    expect(badge).toHaveClass('bg-destructive')
  })

  it('should apply outline variant styles', () => {
    render(<Badge variant="outline">Outline</Badge>)
    const badge = screen.getByText('Outline')
    expect(badge).toHaveClass('text-foreground')
  })

  it('should apply custom color styles', () => {
    render(<Badge color="#ff0000">Custom Color</Badge>)
    const badge = screen.getByText('Custom Color')
    expect(badge).toHaveStyle({
      backgroundColor: '#ff000020',
      color: '#ff0000',
      borderColor: '#ff000040',
    })
  })

  it('should merge custom className', () => {
    render(<Badge className="custom-class">Custom</Badge>)
    const badge = screen.getByText('Custom')
    expect(badge).toHaveClass('custom-class')
  })

  it('should pass through additional props', () => {
    render(<Badge data-testid="test-badge">Props</Badge>)
    expect(screen.getByTestId('test-badge')).toBeInTheDocument()
  })

  it('should have common badge classes', () => {
    render(<Badge>Common Classes</Badge>)
    const badge = screen.getByText('Common Classes')
    expect(badge).toHaveClass('inline-flex')
    expect(badge).toHaveClass('items-center')
    expect(badge).toHaveClass('rounded-full')
    expect(badge).toHaveClass('text-xs')
    expect(badge).toHaveClass('font-semibold')
  })

  it('should preserve existing style when color is provided', () => {
    render(
      <Badge color="#ff0000" style={{ margin: '10px' }}>
        Styled
      </Badge>
    )
    const badge = screen.getByText('Styled')
    expect(badge).toHaveStyle({ margin: '10px' })
  })
})
