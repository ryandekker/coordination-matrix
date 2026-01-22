'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Controller, Control, UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TagInput } from '@/components/ui/tag-input'
import { TemplateTextarea } from '@/components/ui/template-textarea'
import { Task, LookupValue, User, Workflow, WebhookConfig, TaskType } from '@/lib/api'
import { cn } from '@/lib/utils'
import { WebhookTaskConfig } from '../webhook-task-config'
import { MetadataEditor } from './metadata-editor'
import { X, Settings2 } from 'lucide-react'
import {
  TASK_TYPE_CONFIG,
  getTaskTypeConfig,
} from '@/lib/task-type-config'

interface EditDetailsDrawerProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  task: Task
  control: Control<any>
  register: UseFormRegister<any>
  setValue: UseFormSetValue<any>
  watch: UseFormWatch<any>
  workflows: Workflow[]
  users: User[]
  allTasks: Task[]
  statusOptions: LookupValue[]
  urgencyOptions: LookupValue[]
  webhookConfig?: WebhookConfig
  onWebhookConfigChange: (config: WebhookConfig, options?: { skipSave?: boolean }) => void
  onMetadataSave: (parsed: Record<string, unknown>) => Promise<void>
  updateTask: { mutate: (args: { id: string; data: Partial<Task> }) => void }
}

export function EditDetailsDrawer({
  isOpen,
  onOpenChange,
  task,
  control,
  register,
  setValue,
  watch,
  workflows,
  users,
  allTasks,
  statusOptions,
  urgencyOptions,
  webhookConfig,
  onWebhookConfigChange,
  onMetadataSave,
  updateTask,
}: EditDetailsDrawerProps) {
  const [isMetadataEditMode, setIsMetadataEditMode] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const metadataTextareaRef = useRef<HTMLTextAreaElement>(null)
  const savedMetadataValueRef = useRef<string>('')
  const currentMetadataValueRef = useRef<string>('')

  const selectedWorkflowId = watch('workflowId')
  const currentTaskType = watch('taskType') || 'agent'

  // Get workflow stages for the selected workflow
  const workflowStages = workflows
    .find((wf) => wf._id === selectedWorkflowId)
    ?.steps?.map((step) => step.name) || []

  // Filter out current task from parent task options
  const parentTaskOptions = allTasks.filter((t) => t._id !== task._id)

  // Parse metadata for the editor
  const parseMetadataJson = useCallback((value: string): { valid: boolean; parsed: unknown; error: string | null } => {
    const trimmed = value.trim()
    if (!trimmed) {
      return { valid: true, parsed: {}, error: null }
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, parsed: null, error: 'Must be a JSON object' }
      }
      return { valid: true, parsed, error: null }
    } catch {
      return { valid: false, parsed: null, error: 'Invalid JSON' }
    }
  }, [])

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <DrawerTitle>Edit Details</DrawerTitle>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="overflow-y-auto p-4 space-y-6">
          {/* Summary */}
          <Controller
            name="summary"
            control={control}
            render={({ field }) => (
              <TemplateTextarea
                label="Summary"
                value={field.value as string || ''}
                onChange={field.onChange}
                placeholder="Task summary... Use {{variable}} for dynamic values"
                minHeight="80px"
                maxHeight="150px"
                showTokenBrowser={true}
                workflowId={task.workflowId || undefined}
                taskOnly={!task.workflowRunId}
              />
            )}
          />

          {/* Extra Prompt (for agent tasks) */}
          {currentTaskType === 'agent' && (
            <Controller
              name="extraPrompt"
              control={control}
              render={({ field }) => (
                <TemplateTextarea
                  label="Extra Prompt"
                  description="Additional context or instructions for the AI agent"
                  value={field.value as string || ''}
                  onChange={field.onChange}
                  placeholder="Additional instructions for the agent... Use {{variable}} for dynamic values"
                  minHeight="100px"
                  maxHeight="200px"
                  showTokenBrowser={true}
                  workflowId={task.workflowId || undefined}
                  taskOnly={!task.workflowRunId}
                />
              )}
            />
          )}

          {/* Workflow & Stage */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workflow</label>
              <Controller
                name="workflowId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value as string || '_none'}
                    onValueChange={(val) => {
                      field.onChange(val === '_none' ? null : val)
                      if (val === '_none') {
                        setValue('workflowStage', '')
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {workflows
                        .filter((wf) => wf.isActive)
                        .map((wf) => (
                          <SelectItem key={wf._id} value={wf._id}>
                            {wf.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Stage</label>
              <Controller
                name="workflowStage"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value as string || '_none'}
                    onValueChange={(val) => field.onChange(val === '_none' ? '' : val)}
                    disabled={!selectedWorkflowId || workflowStages.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={selectedWorkflowId ? 'Select stage' : 'Select workflow first'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {workflowStages.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {stage}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Due Date</label>
            <Input
              type="datetime-local"
              {...register('dueAt')}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <Controller
              name="tags"
              control={control}
              render={({ field }) => (
                <TagInput
                  value={Array.isArray(field.value) ? field.value : []}
                  onChange={field.onChange}
                  placeholder="Add tags..."
                />
              )}
            />
          </div>

          {/* Parent Task */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Parent Task</label>
            <Controller
              name="parentId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || '_none'}
                  onValueChange={(val) => field.onChange(val === '_none' ? null : val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">No parent</SelectItem>
                    {parentTaskOptions.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        <span className="truncate max-w-[300px]">{t.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Task Type Configuration */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Task Type</label>
            <Controller
              name="taskType"
              control={control}
              render={({ field }) => {
                const typeConfig = getTaskTypeConfig(field.value as string)
                const TypeIcon = typeConfig.icon
                return (
                  <Select
                    value={field.value as string || 'agent'}
                    onValueChange={(val) => {
                      field.onChange(val)
                      // Immediately save task type changes
                      updateTask.mutate({ id: task._id, data: { taskType: val as TaskType } })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <TypeIcon className={cn('h-4 w-4', typeConfig.color)} />
                          <span>{typeConfig.label}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TASK_TYPE_CONFIG)
                        .filter(([key]) => !['webhook', 'trigger'].includes(key))
                        .map(([key, config]) => {
                          const Icon = config.icon
                          return (
                            <SelectItem key={key} value={key}>
                              <div className="flex items-center gap-2">
                                <Icon className={cn('h-4 w-4', config.color)} />
                                <span>{config.label}</span>
                              </div>
                            </SelectItem>
                          )
                        })}
                    </SelectContent>
                  </Select>
                )
              }}
            />
          </div>

          {/* Webhook Configuration (for external tasks) */}
          {currentTaskType === 'external' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Webhook Configuration</label>
              <WebhookTaskConfig
                task={task}
                isEditMode={true}
                webhookConfig={webhookConfig}
                onConfigChange={onWebhookConfigChange}
              />
            </div>
          )}

          {/* ForEach Configuration */}
          {currentTaskType === 'foreach' && (
            <div className="space-y-2 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <label className="text-sm font-medium text-green-800 dark:text-green-200">
                ForEach Configuration
              </label>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Expected Subtasks</label>
                <Input
                  type="number"
                  min="0"
                  defaultValue={task.batchCounters?.expectedCount ?? ''}
                  placeholder="Auto-detect"
                  onBlur={(e) => {
                    const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                    updateTask.mutate({
                      id: task._id,
                      data: {
                        batchCounters: {
                          ...task.batchCounters,
                          expectedCount: newValue,
                        },
                      },
                    })
                  }}
                />
              </div>
            </div>
          )}

          {/* Join Configuration */}
          {currentTaskType === 'join' && (
            <div className="space-y-4 p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg">
              <label className="text-sm font-medium text-indigo-800 dark:text-indigo-200">
                Join Configuration
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Expected Count</label>
                  <Input
                    type="number"
                    min="0"
                    defaultValue={(task as any).joinConfig?.expectedCount ?? ''}
                    placeholder="Auto"
                    onBlur={(e) => {
                      const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                      const currentConfig = (task as any).joinConfig || {}
                      updateTask.mutate({
                        id: task._id,
                        data: {
                          taskType: 'join',
                          joinConfig: {
                            ...currentConfig,
                            expectedCount: newValue,
                          },
                        },
                      })
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Max Wait (ms)</label>
                  <Input
                    type="number"
                    min="0"
                    defaultValue={(task as any).joinConfig?.boundary?.maxWaitMs ?? ''}
                    placeholder="No timeout"
                    onBlur={(e) => {
                      const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                      const currentConfig = (task as any).joinConfig || {}
                      updateTask.mutate({
                        id: task._id,
                        data: {
                          taskType: 'join',
                          joinConfig: {
                            ...currentConfig,
                            boundary: {
                              ...currentConfig.boundary,
                              maxWaitMs: newValue,
                            },
                          },
                        },
                      })
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Input Path (JSONPath)</label>
                <Input
                  className="font-mono text-sm"
                  defaultValue={(task as any).joinConfig?.inputPath ?? ''}
                  placeholder="e.g., output.analysis"
                  onBlur={(e) => {
                    const newValue = e.target.value || undefined
                    const currentConfig = (task as any).joinConfig || {}
                    updateTask.mutate({
                      id: task._id,
                      data: {
                        taskType: 'join',
                        joinConfig: {
                          ...currentConfig,
                          inputPath: newValue,
                        },
                      },
                    })
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  JSONPath to extract from each completed task's output.
                </p>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Metadata (JSON)</label>
            <MetadataEditor
              task={task}
              isEditMode={isMetadataEditMode}
              setIsEditMode={setIsMetadataEditMode}
              metadataError={metadataError}
              setMetadataError={setMetadataError}
              metadataTextareaRef={metadataTextareaRef}
              savedMetadataValueRef={savedMetadataValueRef}
              currentMetadataValueRef={currentMetadataValueRef}
              onSave={onMetadataSave}
              parseMetadataJson={parseMetadataJson}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
