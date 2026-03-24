'use client'

import { useMemo } from 'react'
import { FileText, GitBranch, MessageSquare, Globe, Package, Copy, Check, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Task } from '@/lib/api'
import { useState, useCallback } from 'react'

interface ProducedAsset {
  type: 'document' | 'workflow' | 'workflow-run' | 'conversation' | 'external'
  id: string
  title: string
  url?: string
  action: string
  sourceTaskId: string
  sourceTaskTitle: string
}

interface ProducedAssetsPanelProps {
  task: Task
  childTasks?: Task[]
}

function resolveAssetUrl(type: string, id: string): string | undefined {
  switch (type) {
    case 'document': return `/documents/${id}`
    case 'workflow': return `/workflows?workflowId=${id}`
    case 'workflow-run': return `/workflow-runs?id=${id}`
    case 'external': return id.startsWith('http') ? id : undefined
    default: return undefined
  }
}

function extractAssetsFromTask(task: Task): ProducedAsset[] {
  const assets: ProducedAsset[] = []
  const md = task.metadata as Record<string, unknown> | undefined
  const output = md?.output as Record<string, unknown> | undefined

  // 0. Pre-extracted producedAssets from daemon or workflow engine (preferred path).
  // These are normalized at the system level so we don't need to scan multiple nested paths.
  const preExtracted =
    (task.stepOutput as Record<string, unknown> | undefined)?.producedAssets as Array<Record<string, unknown>> | undefined
    || output?.producedAssets as Array<Record<string, unknown>> | undefined
  if (Array.isArray(preExtracted) && preExtracted.length > 0) {
    for (const a of preExtracted) {
      if (a.type && a.id) {
        assets.push({
          type: a.type as ProducedAsset['type'],
          id: a.id as string,
          title: (a.title as string) || (a.id as string),
          url: resolveAssetUrl(a.type as string, a.id as string),
          action: (a.action as string) || 'Produced',
          sourceTaskId: task._id,
          sourceTaskTitle: task.title,
        })
      }
    }
  }

  // 0b. Pre-extracted assets from inputPayload (manual tasks receiving previous step's assets)
  const inputPayload = md?.inputPayload as Record<string, unknown> | undefined
  const upstreamAssets = inputPayload?.producedAssets as Array<Record<string, unknown>> | undefined
  if (Array.isArray(upstreamAssets) && upstreamAssets.length > 0) {
    for (const a of upstreamAssets) {
      if (a.type && a.id) {
        assets.push({
          type: a.type as ProducedAsset['type'],
          id: a.id as string,
          title: (a.title as string) || (a.id as string),
          url: resolveAssetUrl(a.type as string, a.id as string),
          action: (a.action as string) || 'Produced',
          sourceTaskId: task._id,
          sourceTaskTitle: task.title,
        })
      }
    }
  }

  // 1. Document operations (create/update) from daemon output
  if (output?.documentOperations) {
    const ops = output.documentOperations as Array<Record<string, unknown>>
    for (const op of ops) {
      if ((op.action === 'create' || op.action === 'update') && op.success && op.documentId) {
        assets.push({
          type: 'document',
          id: op.documentId as string,
          title: (op.title as string) || (op.documentId as string),
          url: `/documents/${op.documentId}`,
          action: op.action === 'create' ? 'Created' : 'Updated',
          sourceTaskId: task._id,
          sourceTaskTitle: task.title,
        })
      }
    }
  }

  // 2. Routing operations (triggered workflows) from daemon output
  if (output?.routingOperations) {
    const ops = output.routingOperations as Array<Record<string, unknown>>
    for (const op of ops) {
      if (op.action === 'triggerWorkflow' && op.success && op.workflowRunId) {
        assets.push({
          type: 'workflow-run',
          id: op.workflowRunId as string,
          title: `Workflow Run ${(op.workflowRunId as string).slice(-8)}`,
          url: `/workflow-runs?id=${op.workflowRunId}`,
          action: 'Triggered',
          sourceTaskId: task._id,
          sourceTaskTitle: task.title,
        })
      }
    }
  }

  // 3. Conversation session from daemon output
  if (output?.conversationSessionId) {
    assets.push({
      type: 'conversation',
      id: output.conversationSessionId as string,
      title: 'Agent Conversation',
      url: `/conversations/${output.conversationSessionId}`,
      action: 'Recorded',
      sourceTaskId: task._id,
      sourceTaskTitle: task.title,
    })
  }

  // 4. Spawned workflow run (top-level field on task)
  if (task.spawnedWorkflowRunId) {
    assets.push({
      type: 'workflow-run',
      id: task.spawnedWorkflowRunId,
      title: `Workflow Run ${task.spawnedWorkflowRunId.slice(-8)}`,
      url: `/workflow-runs?id=${task.spawnedWorkflowRunId}`,
      action: 'Spawned',
      sourceTaskId: task._id,
      sourceTaskTitle: task.title,
    })
  }

  // 5. Flow config attempts (nested workflow runs)
  if (task.flowConfig?.attempts) {
    for (const attempt of task.flowConfig.attempts) {
      if (attempt.spawnedWorkflowRunId) {
        const name = attempt.targetWorkflowName || `Workflow Run ${attempt.spawnedWorkflowRunId.slice(-8)}`
        assets.push({
          type: 'workflow-run',
          id: attempt.spawnedWorkflowRunId,
          title: name,
          url: `/workflow-runs?id=${attempt.spawnedWorkflowRunId}`,
          action: 'Spawned',
          sourceTaskId: task._id,
          sourceTaskTitle: task.title,
        })
      }
    }
  }

  // 6. TaskResult: spawnedWorkflow
  if (task.taskResult?.current?.spawnedWorkflow?.runId) {
    const sw = task.taskResult.current.spawnedWorkflow
    assets.push({
      type: 'workflow-run',
      id: sw.runId,
      title: `Workflow Run ${sw.runId.slice(-8)}`,
      url: `/workflow-runs?id=${sw.runId}`,
      action: 'Spawned',
      sourceTaskId: task._id,
      sourceTaskTitle: task.title,
    })
  }

  // 7. TaskResult: documentResults
  if (task.taskResult?.current?.documentResults?.documents) {
    for (const doc of task.taskResult.current.documentResults.documents) {
      assets.push({
        type: 'document',
        id: doc.id,
        title: doc.title || doc.id,
        url: `/documents/${doc.id}`,
        action: 'Found',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
  }

  // 8. StepOutput: nestedWorkflow
  if (task.stepOutput?.nestedWorkflow?.runId) {
    const nw = task.stepOutput.nestedWorkflow
    assets.push({
      type: 'workflow-run',
      id: nw.runId,
      title: `Workflow Run ${nw.runId.slice(-8)}`,
      url: `/workflow-runs?id=${nw.runId}`,
      action: 'Nested',
      sourceTaskId: task._id,
      sourceTaskTitle: task.title,
    })
  }

  // 9. StepOutput: documents
  if (task.stepOutput?.documents) {
    for (const doc of task.stepOutput.documents) {
      assets.push({
        type: 'document',
        id: doc.id,
        title: doc.title || doc.id,
        url: `/documents/${doc.id}`,
        action: 'Found',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
  }

  // 10. Scan output.result for created assets with IDs
  const result = output?.result as Record<string, unknown> | undefined
  if (result) {
    // Look for workflow creation results
    if (result.workflowId && typeof result.workflowId === 'string') {
      assets.push({
        type: 'workflow',
        id: result.workflowId,
        title: (result.workflowName as string) || `Workflow ${(result.workflowId as string).slice(-8)}`,
        url: `/workflows?workflowId=${result.workflowId}`,
        action: 'Created',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
    // Look for external resource references
    if (result.externalUrl && typeof result.externalUrl === 'string') {
      assets.push({
        type: 'external',
        id: result.externalUrl,
        title: (result.externalTitle as string) || result.externalUrl,
        url: result.externalUrl,
        action: 'Created',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
  }

  // 11. For manual tasks: extract assets from inputPayload (previous step's output)
  // Fallback for historical tasks that don't have pre-extracted producedAssets
  const legacyInputPayload = md?.inputPayload as Record<string, unknown> | undefined
  const inputOutput = legacyInputPayload?.output as Record<string, unknown> | undefined
  if (inputOutput) {
    // Workflow definition created by a previous step
    if (inputOutput.workflowId && typeof inputOutput.workflowId === 'string') {
      assets.push({
        type: 'workflow',
        id: inputOutput.workflowId,
        title: (inputOutput.workflowName as string) || `Workflow ${(inputOutput.workflowId as string).slice(-8)}`,
        url: `/workflows?workflowId=${inputOutput.workflowId}`,
        action: 'Created',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
    // Also check inputPayload.output.result for assets (code step pattern)
    const inputResult = inputOutput.result as Record<string, unknown> | undefined
    if (inputResult?.workflowId && typeof inputResult.workflowId === 'string') {
      assets.push({
        type: 'workflow',
        id: inputResult.workflowId,
        title: (inputResult.workflowName as string) || `Workflow ${(inputResult.workflowId as string).slice(-8)}`,
        url: `/workflows?workflowId=${inputResult.workflowId}`,
        action: 'Created',
        sourceTaskId: task._id,
        sourceTaskTitle: task.title,
      })
    }
  }

  // 12. Link to the task's own workflow run (contextual link for workflow tasks)
  if (task.workflowRunId && task.taskType === 'manual') {
    assets.push({
      type: 'workflow-run',
      id: task.workflowRunId,
      title: `Workflow Run ${task.workflowRunId.slice(-8)}`,
      url: `/workflow-runs?id=${task.workflowRunId}`,
      action: 'Part of',
      sourceTaskId: task._id,
      sourceTaskTitle: task.title,
    })
  }

  return assets
}

function deduplicateAssets(assets: ProducedAsset[]): ProducedAsset[] {
  const seen = new Set<string>()
  return assets.filter(asset => {
    const key = `${asset.type}:${asset.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const typeIcons = {
  'document': FileText,
  'workflow': GitBranch,
  'workflow-run': GitBranch,
  'conversation': MessageSquare,
  'external': Globe,
}

const typeLabels = {
  'document': 'Document',
  'workflow': 'Workflow',
  'workflow-run': 'Workflow Run',
  'conversation': 'Conversation',
  'external': 'External Resource',
}

export function ProducedAssetsPanel({ task, childTasks }: ProducedAssetsPanelProps) {
  const assets = useMemo(() => {
    const allAssets: ProducedAsset[] = []

    // Extract from the task itself
    allAssets.push(...extractAssetsFromTask(task))

    // Extract from children
    if (childTasks) {
      for (const child of childTasks) {
        allAssets.push(...extractAssetsFromTask(child))
      }
    }

    return deduplicateAssets(allAssets)
  }, [task, childTasks])

  if (assets.length === 0) return null

  return (
    <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200/50 dark:border-blue-800/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Package className="h-4 w-4 text-blue-500" />
        <span>Produced Assets</span>
        <span className="text-xs text-muted-foreground">
          {assets.length} item{assets.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-1">
        {assets.map((asset, i) => (
          <AssetRow
            key={`${asset.type}-${asset.id}-${i}`}
            asset={asset}
            isFromChild={asset.sourceTaskId !== task._id}
          />
        ))}
      </div>
    </div>
  )
}

function AssetRow({ asset, isFromChild }: { asset: ProducedAsset; isFromChild: boolean }) {
  const [copied, setCopied] = useState(false)
  const Icon = typeIcons[asset.type] || Globe

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(asset.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [asset.id])

  const isExternalUrl = asset.type === 'external' && asset.url?.startsWith('http')

  return (
    <div className={cn(
      'flex items-center gap-2 text-xs rounded px-2 py-1.5',
      'bg-blue-500/5 text-foreground',
    )}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
      <span className="font-medium text-muted-foreground">{asset.action}</span>

      {asset.url && !isExternalUrl ? (
        <Link
          href={asset.url}
          className="inline-flex items-center gap-1 hover:underline text-primary truncate"
        >
          <span className="truncate">{asset.title}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0" />
        </Link>
      ) : isExternalUrl ? (
        <a
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline text-primary truncate"
        >
          <span className="truncate">{asset.title}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0" />
        </a>
      ) : (
        <span className="truncate text-muted-foreground">
          {asset.title}
          <span className="ml-1 font-mono text-[10px]">({typeLabels[asset.type]}: {asset.id})</span>
        </span>
      )}

      {/* Copy ID button for non-linked assets */}
      {!asset.url && (
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto flex-shrink-0 p-0.5 hover:bg-muted rounded"
          title="Copy ID"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      )}

      {isFromChild && (
        <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[120px]" title={asset.sourceTaskTitle}>
          from: {asset.sourceTaskTitle}
        </span>
      )}
    </div>
  )
}
