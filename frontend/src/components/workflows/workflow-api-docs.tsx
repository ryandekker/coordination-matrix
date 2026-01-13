'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Check, Book, Key, Terminal, Code2, Webhook } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getAuthHeader } from '@/lib/auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface ApiKey {
  _id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
}

interface Workflow {
  _id: string
  name: string
}

interface WorkflowApiDocsProps {
  isOpen: boolean
  onClose: () => void
  workflows: Workflow[]
}

async function fetchApiKeys(): Promise<{ data: ApiKey[] }> {
  const response = await fetch(`${API_BASE}/auth/api-keys`, {
    headers: getAuthHeader(),
  })
  if (!response.ok) throw new Error('Failed to fetch API keys')
  return response.json()
}

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto text-sm font-mono">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 hover:bg-slate-700 text-slate-200"
        onClick={handleCopy}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 mr-1" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </>
        )}
      </Button>
    </div>
  )
}

export function WorkflowApiDocs({ isOpen, onClose, workflows }: WorkflowApiDocsProps) {
  const [selectedApiKey, setSelectedApiKey] = useState<string>('')
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('')

  const { data: apiKeysData } = useQuery({
    queryKey: ['api-keys'],
    queryFn: fetchApiKeys,
    enabled: isOpen,
  })

  const apiKeys = apiKeysData?.data?.filter(k => k.isActive) || []
  const selectedKey = apiKeys.find(k => k._id === selectedApiKey)
  const selectedWf = workflows.find(w => w._id === selectedWorkflow)

  // Generate example commands
  const apiKeyPlaceholder = selectedKey ? selectedKey.keyPrefix + '...' : 'YOUR_API_KEY'
  const workflowIdPlaceholder = selectedWf ? selectedWf._id : 'WORKFLOW_ID'
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-server.com'

  const curlStartWorkflow = useMemo(() => `curl -X POST "${baseUrl}/api/workflow-runs" \\
  -H "X-API-Key: ${apiKeyPlaceholder}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workflowId": "${workflowIdPlaceholder}",
    "inputPayload": {
      "type": "support",
      "from": "customer@example.com",
      "subject": "Help needed",
      "body": "I need assistance with..."
    },
    "source": "email-webhook"
  }'`, [baseUrl, apiKeyPlaceholder, workflowIdPlaceholder])

  const emailRoutingWorkflow = `flowchart TD
    trigger["Email Received"]
    route{"Route by Type"}
    support["Handle Support"]
    sales["Handle Sales"]
    billing["Handle Billing"]
    general["Handle General"]

    trigger --> route
    route -->|"type:support"| support
    route -->|"type:sales"| sales
    route -->|"type:billing"| billing
    route --> general

    %% @step(route): {"defaultConnection": "general"}

    classDef agent fill:#3B82F6,color:#fff
    classDef decision fill:#F59E0B,color:#fff

    class trigger,support,sales,billing,general agent
    class route decision`

  const nodeJsExample = useMemo(() => `const axios = require('axios');

async function triggerWorkflow(emailData) {
  const response = await axios.post(
    '${baseUrl}/api/workflow-runs',
    {
      workflowId: '${workflowIdPlaceholder}',
      inputPayload: {
        type: emailData.type,        // Used by decision step
        from: emailData.from,
        subject: emailData.subject,
        body: emailData.body,
      },
      source: 'email-webhook',
    },
    {
      headers: {
        'X-API-Key': '${apiKeyPlaceholder}',
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

// Example: Webhook handler for incoming emails
app.post('/webhook/email', async (req, res) => {
  const { from, subject, body, type } = req.body;

  try {
    const result = await triggerWorkflow({ from, subject, body, type });
    res.json({ success: true, runId: result.run._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});`, [baseUrl, apiKeyPlaceholder, workflowIdPlaceholder])

  const pythonExample = useMemo(() => `import requests

def trigger_workflow(email_data: dict) -> dict:
    """Trigger a workflow with email data."""
    response = requests.post(
        "${baseUrl}/api/workflow-runs",
        headers={
            "X-API-Key": "${apiKeyPlaceholder}",
            "Content-Type": "application/json",
        },
        json={
            "workflowId": "${workflowIdPlaceholder}",
            "inputPayload": {
                "type": email_data["type"],  # Used by decision step
                "from": email_data["from"],
                "subject": email_data["subject"],
                "body": email_data["body"],
            },
            "source": "email-webhook",
        },
    )
    response.raise_for_status()
    return response.json()

# Example usage
result = trigger_workflow({
    "type": "billing",
    "from": "customer@example.com",
    "subject": "Invoice question",
    "body": "I have a question about my invoice...",
})
print(f"Started workflow run: {result['run']['_id']}")`, [baseUrl, apiKeyPlaceholder, workflowIdPlaceholder])

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Book className="h-5 w-5" />
            Workflow API Documentation
          </DialogTitle>
          <DialogDescription>
            Learn how to trigger workflows programmatically via API, including email routing examples.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* API Key & Workflow Selection */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Key className="h-4 w-4" />
                Select API Key
              </label>
              <Select value={selectedApiKey} onValueChange={setSelectedApiKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an API key..." />
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
              {!selectedApiKey && apiKeys.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Select a key to populate examples with your actual API key prefix
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Webhook className="h-4 w-4" />
                Select Workflow
              </label>
              <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a workflow..." />
                </SelectTrigger>
                <SelectContent>
                  {workflows.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No workflows available
                    </SelectItem>
                  ) : (
                    workflows.map((wf) => (
                      <SelectItem key={wf._id} value={wf._id}>
                        {wf.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {!selectedWorkflow && workflows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Select a workflow to populate examples with the workflow ID
                </p>
              )}
            </div>
          </div>

          {/* Tabs for different sections */}
          <Tabs defaultValue="quickstart" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="quickstart">Quick Start</TabsTrigger>
              <TabsTrigger value="email-routing">Email Routing</TabsTrigger>
              <TabsTrigger value="examples">Code Examples</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="reference">API Reference</TabsTrigger>
            </TabsList>

            <TabsContent value="quickstart" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Trigger a Workflow via API</h3>
                <p className="text-sm text-muted-foreground">
                  Use the <code className="bg-muted px-1 rounded">POST /api/workflow-runs</code> endpoint
                  to start a workflow with custom input data.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <span className="font-medium">cURL Example</span>
                </div>
                <CodeBlock code={curlStartWorkflow} />
              </div>

              <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h4 className="font-medium text-blue-900 dark:text-blue-100">How it works</h4>
                <ul className="mt-2 text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                  <li><strong>workflowId</strong> - The ID of the workflow to run</li>
                  <li><strong>inputPayload</strong> - Custom data that flows through the workflow</li>
                  <li><strong>source</strong> - Optional tag to identify where the run originated</li>
                  <li><strong>taskDefaults</strong> - Optional defaults for all tasks (assignee, urgency, tags)</li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="email-routing" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Email Routing with Decision Steps</h3>
                <p className="text-sm text-muted-foreground">
                  Create a workflow that routes incoming emails to different handlers based on email type.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  <span className="font-medium">Sample Mermaid Workflow</span>
                </div>
                <CodeBlock code={emailRoutingWorkflow} language="mermaid" />
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                <h4 className="font-medium text-amber-900 dark:text-amber-100">Decision Step Conditions</h4>
                <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
                  The decision step evaluates conditions against the <code className="bg-amber-200 dark:bg-amber-800 px-1 rounded">inputPayload</code> from the previous step:
                </p>
                <ul className="mt-2 text-sm text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
                  <li><code className="bg-amber-200 dark:bg-amber-800 px-1 rounded">type:support</code> - Routes if type equals &quot;support&quot;</li>
                  <li><code className="bg-amber-200 dark:bg-amber-800 px-1 rounded">type:sales,billing</code> - Routes if type is &quot;sales&quot; OR &quot;billing&quot;</li>
                  <li><code className="bg-amber-200 dark:bg-amber-800 px-1 rounded">priority:urgent</code> - Routes if priority equals &quot;urgent&quot;</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-medium">Integration Pattern</h4>
                <p className="text-sm text-muted-foreground">
                  Connect your email provider (SendGrid, Mailgun, etc.) to this system:
                </p>
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl mb-2">📧</div>
                    <div className="text-sm font-medium">Email Provider</div>
                    <div className="text-xs text-muted-foreground">Receives email</div>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl mb-2">⚡</div>
                    <div className="text-sm font-medium">Your Webhook</div>
                    <div className="text-xs text-muted-foreground">Transforms & calls API</div>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl mb-2">🔄</div>
                    <div className="text-sm font-medium">Workflow Runs</div>
                    <div className="text-xs text-muted-foreground">Routes & processes</div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="examples" className="space-y-4 mt-4">
              <Tabs defaultValue="nodejs" className="w-full">
                <TabsList>
                  <TabsTrigger value="nodejs">Node.js</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                </TabsList>

                <TabsContent value="nodejs" className="mt-4">
                  <CodeBlock code={nodeJsExample} language="javascript" />
                </TabsContent>

                <TabsContent value="python" className="mt-4">
                  <CodeBlock code={pythonExample} language="python" />
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="templates" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">Template Variables</h3>
                <p className="text-sm text-muted-foreground">
                  Use these variables in external step endpoints, headers, and payloads. Variables are wrapped in double curly braces: <code className="bg-muted px-1 rounded">{"{{variable}}"}</code>
                </p>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <h4 className="font-medium text-emerald-900 dark:text-emerald-100 mb-3">System Variables</h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-3">
                    These require server environment variables to be set (see <code>.env.example</code>)
                  </p>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex gap-2">
                      <code className="text-emerald-600 dark:text-emerald-400 min-w-[160px]">{"{{_apiUrl}}"}</code>
                      <span className="text-emerald-800 dark:text-emerald-200">Base API URL from <code>BASE_URL</code> env var</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-emerald-600 dark:text-emerald-400 min-w-[160px]">{"{{_apiKey}}"}</code>
                      <span className="text-emerald-800 dark:text-emerald-200">System API key from <code>MATRIX_API_KEY</code> env var</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-emerald-600 dark:text-emerald-400 min-w-[160px]">{"{{_workflowRunId}}"}</code>
                      <span className="text-emerald-800 dark:text-emerald-200">Current workflow run ID</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-3">Callback Variables</h4>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                    For external steps that need to receive async callbacks
                  </p>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex gap-2">
                      <code className="text-blue-600 dark:text-blue-400 min-w-[160px]">{"{{systemWebhookUrl}}"}</code>
                      <span className="text-blue-800 dark:text-blue-200">Callback URL for async responses</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-blue-600 dark:text-blue-400 min-w-[160px]">{"{{callbackSecret}}"}</code>
                      <span className="text-blue-800 dark:text-blue-200">Auth token for callback validation</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-blue-600 dark:text-blue-400 min-w-[160px]">{"{{workflowRunId}}"}</code>
                      <span className="text-blue-800 dark:text-blue-200">Current workflow run ID</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-blue-600 dark:text-blue-400 min-w-[160px]">{"{{stepId}}"}</code>
                      <span className="text-blue-800 dark:text-blue-200">Current step ID</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-blue-600 dark:text-blue-400 min-w-[160px]">{"{{taskId}}"}</code>
                      <span className="text-blue-800 dark:text-blue-200">Current task ID</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg">
                  <h4 className="font-medium text-purple-900 dark:text-purple-100 mb-3">Data Variables</h4>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-3">
                    Access data from previous steps. Use the Token Browser in the step editor to see available paths.
                  </p>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex gap-2">
                      <code className="text-purple-600 dark:text-purple-400 min-w-[160px]">{"{{output.field}}"}</code>
                      <span className="text-purple-800 dark:text-purple-200">Previous step&apos;s output</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-purple-600 dark:text-purple-400 min-w-[160px]">{"{{output.result.data}}"}</code>
                      <span className="text-purple-800 dark:text-purple-200">Nested output (agent steps wrap in <code>result</code>)</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-purple-600 dark:text-purple-400 min-w-[160px]">{"{{input.field}}"}</code>
                      <span className="text-purple-800 dark:text-purple-200">Initial workflow input payload</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-purple-600 dark:text-purple-400 min-w-[160px]">{"{{item}}"}</code>
                      <span className="text-purple-800 dark:text-purple-200">Current item in foreach loop</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="text-purple-600 dark:text-purple-400 min-w-[160px]">{"{{_index}}"}</code>
                      <span className="text-purple-800 dark:text-purple-200">Current index in foreach loop</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <h4 className="font-medium text-amber-900 dark:text-amber-100 mb-3">Example: Internal API Call</h4>
                  <CodeBlock code={`{
  "endpoint": "{{_apiUrl}}/documents",
  "headers": {
    "Content-Type": "application/json",
    "X-API-Key": "{{_apiKey}}"
  },
  "payloadTemplate": {
    "title": "{{output.result.document.title}}",
    "content": "{{output.result.document.content}}",
    "workflowRunId": "{{_workflowRunId}}"
  }
}`} language="json" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="reference" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">POST /api/workflow-runs</h3>
                  <p className="text-sm text-muted-foreground">Start a new workflow run</p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Headers</h4>
                  <div className="bg-muted rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <Badge variant="secondary">Required</Badge>
                      <div>
                        <code className="text-sm">X-API-Key</code>
                        <p className="text-xs text-muted-foreground">Your API key for authentication</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Badge variant="secondary">Required</Badge>
                      <div>
                        <code className="text-sm">Content-Type: application/json</code>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Request Body</h4>
                  <div className="bg-muted rounded-lg p-3 space-y-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium">workflowId</code>
                        <Badge variant="destructive" className="text-xs">Required</Badge>
                        <span className="text-xs text-muted-foreground">string</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">The ID of the workflow to run</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium">inputPayload</code>
                        <Badge variant="outline" className="text-xs">Optional</Badge>
                        <span className="text-xs text-muted-foreground">object</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Custom data that flows through the workflow. Accessible via <code>{"{{input.field}}"}</code> in templates
                        and evaluated by decision steps.
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium">taskDefaults</code>
                        <Badge variant="outline" className="text-xs">Optional</Badge>
                        <span className="text-xs text-muted-foreground">object</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Defaults applied to all tasks: <code>assigneeId</code>, <code>urgency</code>, <code>tags</code>
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium">source</code>
                        <Badge variant="outline" className="text-xs">Optional</Badge>
                        <span className="text-xs text-muted-foreground">string</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Where this run was triggered from (e.g., &quot;email-webhook&quot;)</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-medium">externalId</code>
                        <Badge variant="outline" className="text-xs">Optional</Badge>
                        <span className="text-xs text-muted-foreground">string</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">External reference ID for correlation</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">Response</h4>
                  <CodeBlock code={`{
  "run": {
    "_id": "workflow-run-id",
    "workflowId": "workflow-id",
    "status": "running",
    "rootTaskId": "task-id",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}`} language="json" />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
