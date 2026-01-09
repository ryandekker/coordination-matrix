import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('should render button with children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('should call onClick handler when clicked', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should be disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('should not call onClick when disabled', () => {
    const handleClick = vi.fn()
    render(
      <Button onClick={handleClick} disabled>
        Disabled
      </Button>
    )

    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).not.toHaveBeenCalled()
  })

  describe('variants', () => {
    it('should apply default variant styles', () => {
      render(<Button>Default</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary')
    })

    it('should apply destructive variant styles', () => {
      render(<Button variant="destructive">Destructive</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-destructive')
    })

    it('should apply outline variant styles', () => {
      render(<Button variant="outline">Outline</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('border')
      expect(button).toHaveClass('bg-background')
    })

    it('should apply secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-secondary')
    })

    it('should apply ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('hover:bg-muted')
    })

    it('should apply link variant styles', () => {
      render(<Button variant="link">Link</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-primary')
      expect(button).toHaveClass('underline-offset-4')
    })
  })

  describe('sizes', () => {
    it('should apply default size', () => {
      render(<Button>Default Size</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-10')
      expect(button).toHaveClass('px-4')
    })

    it('should apply sm size', () => {
      render(<Button size="sm">Small</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-9')
      expect(button).toHaveClass('px-3')
    })

    it('should apply lg size', () => {
      render(<Button size="lg">Large</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-11')
      expect(button).toHaveClass('px-8')
    })

    it('should apply icon size', () => {
      render(<Button size="icon">Icon</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('h-10')
      expect(button).toHaveClass('w-10')
    })
  })

  it('should merge custom className', () => {
    render(<Button className="custom-class">Custom</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
  })

  it('should forward ref to button element', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(<Button ref={ref}>Ref Test</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('should support type attribute', () => {
    render(<Button type="submit">Submit</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
  })

  it('should have common button classes', () => {
    render(<Button>Classes</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('inline-flex')
    expect(button).toHaveClass('items-center')
    expect(button).toHaveClass('justify-center')
    expect(button).toHaveClass('rounded-md')
    expect(button).toHaveClass('text-sm')
    expect(button).toHaveClass('font-medium')
  })

  it('should apply disabled styles when disabled', () => {
    render(<Button disabled>Disabled Styles</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('disabled:pointer-events-none')
    expect(button).toHaveClass('disabled:opacity-50')
  })
})
