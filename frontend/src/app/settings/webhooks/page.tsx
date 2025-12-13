'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Plus, Trash2, RotateCcw, Eye, EyeOff, TestTube, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { webhooksApi, Webhook, WebhookDelivery } from '@/lib/api'

const WEBHOOK_TRIGGERS = [
  { value: 'task.created', label: 'Task Created' },
  { value: 'task.updated', label: 'Task Updated' },
  { value: 'task.deleted', label: 'Task Deleted' },
  { value: 'task.status.changed', label: 'Status Changed' },
  { value: 'task.assignee.changed', label: 'Assignee Changed' },
  { value: 'task.priority.changed', label: 'Priority Changed' },
  { value: 'task.entered_filter', label: 'Entered Filter' },
]

function WebhookForm({
  webhook,
  onSave,
  onCancel,
  isSaving,
}: {
  webhook?: Webhook | null
  onSave: (data: Partial<Webhook>) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [name, setName] = useState(webhook?.name || '')
  const [url, setUrl] = useState(webhook?.url || '')
  const [triggers, setTriggers] = useState<string[]>(webhook?.triggers || ['task.updated'])
  const [filterQuery, setFilterQuery] = useState(webhook?.filterQuery || '')
  const [isActive, setIsActive] = useState(webhook?.isActive ?? true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ name, url, triggers, filterQuery: filterQuery || undefined, isActive })
  }

  const toggleTrigger = (trigger: string) => {
    setTriggers(prev =>
      prev.includes(trigger)
        ? prev.filter(t => t !== trigger)
        : [...prev, trigger]
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Name *</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Webhook"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">URL *</label>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Triggers *</label>
        <div className="grid grid-cols-2 gap-2">
          {WEBHOOK_TRIGGERS.map((trigger) => (
            <label
              key={trigger.value}
              className={cn(
                'flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors',
                triggers.includes(trigger.value)
                  ? 'bg-primary/10 border-primary'
                  : 'hover:bg-muted'
              )}
            >
              <input
                type="checkbox"
                checked={triggers.includes(trigger.value)}
                onChange={() => toggleTrigger(trigger.value)}
                className="rounded"
              />
              <span className="text-sm">{trigger.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Filter Query (Optional)</label>
        <Input
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="status:pending AND urgency:high"
        />
        <p className="text-xs text-muted-foreground">
          Only trigger for tasks matching this filter. Supports: status:value, urgency:value, tag:value
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="rounded"
        />
        <label htmlFor="isActive" className="text-sm">Active</label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving || triggers.length === 0}>
          {isSaving ? 'Saving...' : webhook ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function SecretDisplay({ secret, webhookId }: { secret: string; webhookId: string }) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()

  const rotateSecret = useMutation({
    mutationFn: () => webhooksApi.rotateSecret(webhookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
  })

  const handleCopy = () => {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 text-xs bg-muted px-2 py-1 rounded font-mono">
        {visible ? secret : '••••••••••••••••••••'}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => rotateSecret.mutate()}
        disabled={rotateSecret.isPending}
        title="Rotate secret"
      >
        <RotateCcw className={cn('h-3 w-3', rotateSecret.isPending && 'animate-spin')} />
      </Button>
    </div>
  )
}

function DeliveryHistory({ webhookId }: { webhookId: string }) {
  const [expanded, setExpanded] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () => webhooksApi.getDeliveries(webhookId, { limit: 10 }),
    enabled: expanded,
  })

  const retryDelivery = useMutation({
    mutationFn: webhooksApi.retryDelivery,
  })

  const deliveries = data?.data || []

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Recent Deliveries
      </button>

      {expanded && (
        <div className="mt-2 border rounded p-2 space-y-2">
          {isLoading ? (
            <div className="text-xs text-muted-foreground">Loading...</div>
          ) : deliveries.length === 0 ? (
            <div className="text-xs text-muted-foreground">No deliveries yet</div>
          ) : (
            deliveries.map((delivery) => (
              <div
                key={delivery._id}
                className="flex items-center justify-between text-xs border-b pb-1 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full',
                      delivery.status === 'success' && 'bg-green-500',
                      delivery.status === 'failed' && 'bg-red-500',
                      delivery.status === 'pending' && 'bg-yellow-500',
                      delivery.status === 'retrying' && 'bg-orange-500'
                    )}
                  />
                  <span>{delivery.eventType}</span>
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(delivery.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {delivery.statusCode && (
                    <span className="text-muted-foreground">HTTP {delivery.statusCode}</span>
                  )}
                  {delivery.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => retryDelivery.mutate(delivery._id)}
                      disabled={retryDelivery.isPending}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function WebhookCard({ webhook }: { webhook: Webhook }) {
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()

  const updateWebhook = useMutation({
    mutationFn: (data: Partial<Webhook>) => webhooksApi.update(webhook._id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      setEditing(false)
    },
  })

  const deleteWebhook = useMutation({
    mutationFn: () => webhooksApi.delete(webhook._id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
    },
  })

  const testWebhook = useMutation({
    mutationFn: () => webhooksApi.test(webhook._id),
  })

  return (
    <div className={cn('border rounded-lg p-4', !webhook.isActive && 'opacity-60')}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{webhook.name}</h3>
            {!webhook.isActive && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded">Inactive</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{webhook.url}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => testWebhook.mutate()}
            disabled={testWebhook.isPending}
            title="Send test webhook"
          >
            <TestTube className={cn('h-4 w-4', testWebhook.isPending && 'animate-pulse')} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setEditing(true)}>
            <span className="text-sm">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm('Delete this webhook?')) {
                deleteWebhook.mutate()
              }
            }}
            disabled={deleteWebhook.isPending}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-1">
          {webhook.triggers.map((trigger) => (
            <span
              key={trigger}
              className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded"
            >
              {WEBHOOK_TRIGGERS.find(t => t.value === trigger)?.label || trigger}
            </span>
          ))}
        </div>

        {webhook.filterQuery && (
          <p className="text-xs text-muted-foreground">
            Filter: <code className="bg-muted px-1 rounded">{webhook.filterQuery}</code>
          </p>
        )}

        <div className="text-xs text-muted-foreground">
          Secret:
          <SecretDisplay secret={webhook.secret} webhookId={webhook._id} />
        </div>

        <DeliveryHistory webhookId={webhook._id} />
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Webhook</DialogTitle>
          </DialogHeader>
          <WebhookForm
            webhook={webhook}
            onSave={(data) => updateWebhook.mutate(data)}
            onCancel={() => setEditing(false)}
            isSaving={updateWebhook.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function WebhooksPage() {
  const [creating, setCreating] = useState(false)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => webhooksApi.list(),
  })

  const createWebhook = useMutation({
    mutationFn: webhooksApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      setCreating(false)
    },
  })

  const webhooks = data?.data || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground">
            Configure webhooks to notify external services when task events occur
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading webhooks...</div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/50">
          <p className="text-muted-foreground mb-4">No webhooks configured</p>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create your first webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => (
            <WebhookCard key={webhook._id} webhook={webhook} />
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Webhook</DialogTitle>
          </DialogHeader>
          <WebhookForm
            onSave={(data) => createWebhook.mutate(data)}
            onCancel={() => setCreating(false)}
            isSaving={createWebhook.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
