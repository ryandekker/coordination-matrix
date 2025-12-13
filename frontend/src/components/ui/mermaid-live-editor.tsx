'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Mermaid } from './mermaid'
import { Button } from './button'
import { cn } from '@/lib/utils'
import {
  Download,
  Upload,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Code2,
  Eye,
  Columns,
  PanelLeft,
  PanelRight,
} from 'lucide-react'

interface MermaidLiveEditorProps {
  value: string
  onChange: (value: string) => void
  onError?: (error: string | null) => void
  placeholder?: string
  className?: string
  minHeight?: string
  showToolbar?: boolean
  initialLayout?: 'split' | 'code' | 'preview'
}

type LayoutMode = 'split' | 'code' | 'preview'

const DEFAULT_PLACEHOLDER = `flowchart TD
    A[Start] --> B{Decision}
    B -->|"yes"| C[Process]
    B -->|"no"| D[End]
    C --> D`

export function MermaidLiveEditor({
  value,
  onChange,
  onError,
  placeholder = DEFAULT_PLACEHOLDER,
  className = '',
  minHeight = '400px',
  showToolbar = true,
  initialLayout = 'split',
}: MermaidLiveEditorProps) {
  const [layout, setLayout] = useState<LayoutMode>(initialLayout)
  const [zoom, setZoom] = useState(130)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleError = useCallback((err: string) => {
    setError(err)
    onError?.(err)
  }, [onError])

  const handleChange = useCallback((newValue: string) => {
    setError(null)
    onError?.(null)
    onChange(newValue)
  }, [onChange, onError])

  const copyToClipboard = useCallback(async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [value])

  const exportMermaid = useCallback(() => {
    const blob = new Blob([value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.mmd'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [value])

  const importFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      handleChange(content)
    }
    reader.readAsText(file)
    event.target.value = '' // Reset for re-uploading same file
  }, [handleChange])

  const handleZoom = useCallback((delta: number) => {
    setZoom(prev => Math.min(200, Math.max(50, prev + delta)))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(100)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!editorRef.current) return
    if (!isFullscreen) {
      editorRef.current.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
    setIsFullscreen(!isFullscreen)
  }, [isFullscreen])

  // Handle line numbers
  const getLineNumbers = () => {
    const lines = value.split('\n').length
    return Array.from({ length: Math.max(lines, 10) }, (_, i) => i + 1)
  }

  // Insert example at cursor
  const insertExample = useCallback((example: string) => {
    if (!textareaRef.current) return
    const { selectionStart, selectionEnd } = textareaRef.current
    const newValue = value.slice(0, selectionStart) + example + value.slice(selectionEnd)
    handleChange(newValue)
    // Move cursor to end of inserted text
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = selectionStart + example.length
        textareaRef.current.setSelectionRange(newPos, newPos)
        textareaRef.current.focus()
      }
    }, 0)
  }, [value, handleChange])

  return (
    <div
      ref={editorRef}
      className={cn(
        'flex flex-col border rounded-lg overflow-hidden bg-background',
        isFullscreen && 'fixed inset-0 z-50',
        className
      )}
      style={{ minHeight }}
    >
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1.5 gap-2">
          <div className="flex items-center gap-1">
            {/* Layout buttons */}
            <div className="flex items-center bg-muted rounded-md p-0.5">
              <Button
                type="button"
                variant={layout === 'code' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setLayout('code')}
                title="Code only"
              >
                <Code2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={layout === 'split' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setLayout('split')}
                title="Split view"
              >
                <Columns className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant={layout === 'preview' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2"
                onClick={() => setLayout('preview')}
                title="Preview only"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>

            <div className="h-4 w-px bg-border mx-1" />

            {/* Zoom controls */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleZoom(-10)}
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center">{zoom}%</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleZoom(10)}
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={resetZoom}
              title="Reset zoom"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            {/* Copy button */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={copyToClipboard}
              disabled={!value}
            >
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              <span className="text-xs hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
            </Button>

            {/* Export */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={exportMermaid}
              disabled={!value}
            >
              <Download className="h-4 w-4" />
              <span className="text-xs hidden sm:inline">Export</span>
            </Button>

            {/* Import */}
            <label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1 cursor-pointer"
                asChild
              >
                <span>
                  <Upload className="h-4 w-4" />
                  <span className="text-xs hidden sm:inline">Import</span>
                </span>
              </Button>
              <input
                type="file"
                accept=".mmd,.txt"
                className="hidden"
                onChange={importFile}
              />
            </label>

            <div className="h-4 w-px bg-border mx-1" />

            {/* Fullscreen */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Code editor */}
        {(layout === 'code' || layout === 'split') && (
          <div className={cn(
            'flex flex-col overflow-hidden border-r bg-muted/20',
            layout === 'split' ? 'w-1/2' : 'w-full'
          )}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                Mermaid Code
              </span>
              <span className="text-xs text-muted-foreground">
                {value.split('\n').length} lines
              </span>
            </div>
            <div className="flex-1 flex overflow-hidden">
              {/* Line numbers */}
              <div className="flex-shrink-0 py-2 px-2 text-right bg-muted/30 border-r select-none">
                {getLineNumbers().map(num => (
                  <div key={num} className="text-xs text-muted-foreground h-[21px] leading-[21px]">
                    {num}
                  </div>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => handleChange(e.target.value)}
                placeholder={placeholder}
                spellCheck={false}
                className={cn(
                  'flex-1 resize-none py-2 px-3 text-sm font-mono leading-[21px]',
                  'bg-transparent border-0 outline-none',
                  'placeholder:text-muted-foreground/50',
                  'focus:ring-0 focus:outline-none'
                )}
                style={{ tabSize: 2 }}
              />
            </div>
          </div>
        )}

        {/* Preview panel */}
        {(layout === 'preview' || layout === 'split') && (
          <div className={cn(
            'flex flex-col overflow-hidden',
            layout === 'split' ? 'w-1/2' : 'w-full'
          )}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </span>
              {error && (
                <span className="text-xs text-destructive">Syntax error</span>
              )}
            </div>
            <div
              className="flex-1 overflow-auto p-4 bg-white flex items-center justify-center"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
            >
              {value ? (
                <Mermaid
                  chart={value}
                  className="mermaid-preview-centered"
                  onError={handleError}
                />
              ) : (
                <div className="text-center text-muted-foreground p-8">
                  <Code2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Enter Mermaid code to see preview</p>
                  <p className="text-xs mt-1">Supports flowcharts, sequences, and more</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Syntax help footer */}
      <div className="border-t bg-muted/20 px-3 py-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3 flex-wrap">
          <span><code className="bg-blue-100 text-blue-700 px-1 rounded">[ ]</code> agent</span>
          <span><code className="bg-orange-100 text-orange-700 px-1 rounded">{"{{"} {"}}"}</code> external</span>
          <span><code className="bg-purple-100 text-purple-700 px-1 rounded">( )</code> manual</span>
          <span><code className="bg-amber-100 text-amber-700 px-1 rounded">{"{ }"}</code> decision</span>
          <span><code className="bg-green-100 text-green-700 px-1 rounded">[[ ]]</code> loop/join</span>
          <span><code className="bg-muted px-1 rounded">--&gt;</code> flow</span>
        </div>
        <a
          href="https://mermaid.js.org/syntax/flowchart.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Docs →
        </a>
      </div>
    </div>
  )
}
