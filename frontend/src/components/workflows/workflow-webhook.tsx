'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Check, Key, Webhook, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface ApiKey {
  _id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
}

interface WorkflowWebhookProps {
  workflowId?: string
  workflowName?: string
}

async function fetchApiKeys(): Promise<{ data: ApiKey[] }> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to fetch API keys')
  return response.json()
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          {label || 'Copy'}
        </>
      )}
    </Button>
  )
}

export function WorkflowWebhook({ workflowId, workflowName }: WorkflowWebhookProps) {
  const [selectedApiKey, setSelectedApiKey] = useState<string>('')

  const { data: apiKeysData } = useQuery({
    queryKey: ['api-keys'],
    queryFn: fetchApiKeys,
  })

  const apiKeys = apiKeysData?.data?.filter(k => k.isActive) || []
  const selectedKey = apiKeys.find(k => k._id === selectedApiKey)

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-server.com'
  const webhookUrl = `${baseUrl}/api/workflow-runs`
  const apiKeyPlaceholder = selectedKey ? selectedKey.keyPrefix + '...' : 'YOUR_API_KEY'
  const workflowIdValue = workflowId || 'WORKFLOW_ID'

  const sampleBody = useMemo(() => JSON.stringify({
    workflowId: workflowIdValue,
    inputPayload: {
      // Add your custom data here
      example: 'value',
    },
    source: 'external-webhook',
  }, null, 2), [workflowIdValue])

  const curlCommand = useMemo(() => `curl -X POST "${webhookUrl}" \\
  -H "X-API-Key: ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    workflowId: workflowIdValue,
    inputPayload: { example: 'value' },
    source: 'external-webhook',
  })}'`, [webhookUrl, apiKeyPlaceholder, workflowIdValue])

  // Only show if workflow has been saved (has an ID)
  if (!workflowId) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center gap-2 mb-2">
          <Webhook className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Webhook Trigger</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Save this workflow first to get the webhook URL and sample request body.
        </p>
      </div>
    )
  }

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-medium">Webhook Trigger</h3>
        </div>
        <a
          href="/settings/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          Manage API Keys
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        Use this endpoint to trigger the workflow from external systems like Zapier, Make, or custom integrations.
      </p>

      {/* API Key Selector */}
      <div className="space-y-1">
        <label className="text-xs font-medium flex items-center gap-1">
          <Key className="h-3 w-3" />
          API Key
        </label>
        <Select value={selectedApiKey} onValueChange={setSelectedApiKey}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select an API key to populate examples..." />
          </SelectTrigger>
          <SelectContent>
            {apiKeys.length === 0 ? (
              <SelectItem value="none" disabled>
                No active API keys - create one in Settings
              </SelectItem>
            ) : (
              apiKeys.map((key) => (
                <SelectItem key={key._id} value={key._id}>
                  <div className="flex items-center gap-2">
                    <span>{key.name}</span>
                    <code className="text-xs bg-muted px-1 rounded">{key.keyPrefix}</code>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Webhook URL */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Endpoint URL</label>
          <CopyButton text={webhookUrl} />
        </div>
        <div className="bg-slate-950 text-slate-50 p-2 rounded text-xs font-mono break-all">
          POST {webhookUrl}
        </div>
      </div>

      {/* Headers */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Required Headers</label>
          <CopyButton
            text={`X-API-Key: ${apiKeyPlaceholder}\nContent-Type: application/json`}
          />
        </div>
        <div className="bg-slate-950 text-slate-50 p-2 rounded text-xs font-mono space-y-0.5">
          <div>X-API-Key: <span className="text-green-400">{apiKeyPlaceholder}</span></div>
          <div>Content-Type: <span className="text-green-400">application/json</span></div>
        </div>
      </div>

      {/* Sample Body */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Sample Request Body</label>
          <CopyButton text={sampleBody} />
        </div>
        <div className="bg-slate-950 text-slate-50 p-2 rounded text-xs font-mono overflow-x-auto">
          <pre>{sampleBody}</pre>
        </div>
        <p className="text-xs text-muted-foreground">
          The <code className="bg-muted px-1 rounded">inputPayload</code> object is passed to workflow steps
          and accessible via <code className="bg-muted px-1 rounded">{`{{input.field}}`}</code> tokens.
        </p>
      </div>

      {/* cURL Example */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">cURL Example</label>
          <CopyButton text={curlCommand} />
        </div>
        <div className="bg-slate-950 text-slate-50 p-2 rounded text-xs font-mono overflow-x-auto">
          <pre className="whitespace-pre-wrap">{curlCommand}</pre>
        </div>
      </div>

      {/* Workflow Info */}
      <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
        <div className="flex items-center justify-between">
          <span>Workflow ID:</span>
          <div className="flex items-center gap-1">
            <code className="bg-muted px-1 rounded">{workflowId}</code>
            <CopyButton text={workflowId} label="" />
          </div>
        </div>
        {workflowName && (
          <div className="flex items-center justify-between">
            <span>Workflow:</span>
            <span className="font-medium">{workflowName}</span>
          </div>
        )}
      </div>
    </div>
  )
}
