'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Task, FieldConfig, LookupValue, TaskType, WebhookConfig } from '@/lib/api'
import { useCreateTask, useUpdateTask, useUsers, useWorkflows, useTasks } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import { TaskActivity } from './task-activity'
import { TaskFiles } from './task-files'
import { WebhookTaskConfig } from './webhook-task-config'
import { JsonViewer } from '@/components/ui/json-viewer'
import {
  TASK_TYPE_CONFIG,
  getTaskTypeConfig,
  TASK_MODAL_TAB_KEY,
  TASK_MODAL_TABS,
  DEFAULT_TASK_MODAL_TAB,
  type TaskModalTab,
} from '@/lib/task-type-config'
import { Settings2, Database, Activity, Workflow, ExternalLink, ArrowUpRight, Paperclip } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface TaskModalProps {
  task: Task | null
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  parentTask?: Task | null
  onClose: () => void
}

export function TaskModal({
  task,
  isOpen,
  fieldConfigs,
  lookups,
  parentTask = null,
  onClose,
}: TaskModalProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const prevIsOpenRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [isMetadataEditMode, setIsMetadataEditMode] = useState(false)
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig | undefined>(undefined)
  const metadataTextareaRef = useRef<HTMLTextAreaElement>(null)
  const savedMetadataValueRef = useRef<string>('') // Track last saved value for reset
  const currentMetadataValueRef = useRef<string>('') // Track current textarea value to restore after re-renders

  // Right sidebar tab state - persisted to localStorage
  const [activeTab, setActiveTab] = useState<TaskModalTab>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(TASK_MODAL_TAB_KEY)
      if (stored && Object.values(TASK_MODAL_TABS).includes(stored as TaskModalTab)) {
        return stored as TaskModalTab
      }
    }
    return DEFAULT_TASK_MODAL_TAB
  })

  // Persist tab selection to localStorage
  const handleTabChange = useCallback((value: string) => {
    const tab = value as TaskModalTab
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem(TASK_MODAL_TAB_KEY, tab)
    }
  }, [])

  // Auto-save refs (using refs to avoid re-renders during typing)
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedDataRef = useRef<string>('')
  const pendingChangesRef = useRef<Record<string, unknown> | null>(null)

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()

  // Only fetch users and workflows when modal is open
  const { data: usersData } = useUsers()
  const { data: workflowsData } = useWorkflows()

  // Only fetch tasks list for parent task selector when editing (not creating)
  // This significantly reduces unnecessary data fetching
  const { data: tasksData } = useTasks({
    limit: 50,
    enabled: isOpen && !!task // Only fetch when editing an existing task
  })

  const users = usersData?.data || []
  const workflows = workflowsData?.data || []
  const allTasks = tasksData?.data || []

  const statusOptions = lookups['task_status'] || []
  const urgencyOptions = lookups['urgency'] || []

  // Invalidate activity cache when modal opens to ensure fresh data
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current && task?._id) {
      queryClient.invalidateQueries({ queryKey: ['activity-logs', 'task', task._id] })
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, task?._id, queryClient])

  // Auto-focus title input when creating a new task
  useEffect(() => {
    if (isOpen && !task) {
      // Small delay to ensure the dialog is rendered
      const timer = setTimeout(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, task])

  const editableFields = useMemo(() => {
    return fieldConfigs
      .filter((fc) => fc.isEditable)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [fieldConfigs])

  // Core fields that must always be in the form, regardless of field configs
  const coreDefaultValues: Record<string, unknown> = {
    title: '',
    summary: '',
    extraPrompt: '',
    additionalInfo: '',
    status: 'pending',
    urgency: 'normal',
    workflowId: null,
    workflowStage: '',
    assigneeId: null,
    dueAt: null,
    tags: '',
    taskType: 'agent',
  }

  const defaultValues = useMemo(() => {
    // Start with core defaults to ensure form always works
    const values: Record<string, unknown> = { ...coreDefaultValues }

    // Override with field config values if available
    editableFields.forEach((fc) => {
      if (fc.defaultValue !== undefined) {
        values[fc.fieldPath] = fc.defaultValue
      } else {
        switch (fc.fieldType) {
          case 'text':
          case 'textarea':
            values[fc.fieldPath] = ''
            break
          case 'select':
            values[fc.fieldPath] = fc.defaultValue || ''
            break
          case 'tags':
            values[fc.fieldPath] = ''
            break
          case 'reference':
            values[fc.fieldPath] = null
            break
          case 'datetime':
            values[fc.fieldPath] = null
            break
          case 'boolean':
            values[fc.fieldPath] = false
            break
          case 'number':
            values[fc.fieldPath] = ''
            break
          default:
            values[fc.fieldPath] = ''
        }
      }
    })
    return values
  }, [editableFields])

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    getValues,
    formState: { isSubmitting },
  } = useForm({
    defaultValues,
  })

  const selectedWorkflowId = watch('workflowId') as string | null
  const currentTaskType = watch('taskType') as string

  // Memoize workflow lookup to prevent unnecessary recalculations
  const selectedWorkflow = useMemo(
    () => workflows.find(w => w._id === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  )

  // Support both 'steps' (new format) and 'stages' (legacy format)
  const workflowStages = useMemo(
    () => selectedWorkflow?.steps?.map(s => s.name) || selectedWorkflow?.stages || [],
    [selectedWorkflow]
  )

  useEffect(() => {
    if (task) {
      const values: Record<string, unknown> = {}

      // First, load core fields from the task (like taskType)
      Object.keys(coreDefaultValues).forEach((field) => {
        const value = (task as unknown as Record<string, unknown>)[field]
        if (field === 'tags' && Array.isArray(value)) {
          values[field] = value.join(', ')
        } else if (field === 'dueAt' && value) {
          values[field] = new Date(value as string).toISOString().slice(0, 16)
        } else {
          values[field] = value ?? coreDefaultValues[field]
        }
      })

      // Then load editable fields (may override some core fields)
      editableFields.forEach((fc) => {
        const value = (task as unknown as Record<string, unknown>)[fc.fieldPath]
        if (fc.fieldType === 'tags' && Array.isArray(value)) {
          values[fc.fieldPath] = value.join(', ')
        } else if (fc.fieldType === 'datetime' && value) {
          values[fc.fieldPath] = new Date(value as string).toISOString().slice(0, 16)
        } else if (fc.fieldType === 'reference' && value) {
          values[fc.fieldPath] = String(value)
        } else {
          values[fc.fieldPath] = value ?? fc.defaultValue ?? ''
        }
      })
      reset(values)
      // Initialize last saved data ref when task loads
      lastSavedDataRef.current = JSON.stringify(values)
      // Initialize webhook config from task
      setWebhookConfig(task.webhookConfig)
    } else {
      const values = { ...defaultValues }
      if (parentTask) {
        values.parentId = parentTask._id
      }
      reset(values)
      lastSavedDataRef.current = ''
      setWebhookConfig(undefined)
    }
  }, [task, parentTask, reset, editableFields, defaultValues])

  // Build task data from form values (shared between auto-save and submit)
  const buildTaskData = useCallback((data: Record<string, unknown>): Partial<Task> => {
    const taskData: Partial<Task> = {}

    editableFields.forEach((fc) => {
      const value = data[fc.fieldPath]

      if (fc.fieldType === 'tags' && typeof value === 'string') {
        taskData[fc.fieldPath as keyof Task] = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as never
      } else if (fc.fieldType === 'datetime' && value) {
        taskData[fc.fieldPath as keyof Task] = new Date(value as string).toISOString() as never
      } else if (fc.fieldType === 'datetime' && !value) {
        taskData[fc.fieldPath as keyof Task] = null as never
      } else if (fc.fieldType === 'reference') {
        taskData[fc.fieldPath as keyof Task] = (value || null) as never
      } else if (fc.fieldType === 'number' && value !== '') {
        taskData[fc.fieldPath as keyof Task] = Number(value) as never
      } else if (fc.fieldType === 'boolean') {
        taskData[fc.fieldPath as keyof Task] = Boolean(value) as never
      } else {
        taskData[fc.fieldPath as keyof Task] = value as never
      }
    })

    return taskData
  }, [editableFields])

  // Auto-save function (called on blur of fields)
  const performAutoSave = useCallback(async () => {
    if (!task) return

    const data = getValues()
    const currentDataStr = JSON.stringify(data)
    if (currentDataStr === lastSavedDataRef.current) return

    try {
      const taskData = buildTaskData(data)
      // Note: metadata is saved separately via its own Save button
      await updateTask.mutateAsync({ id: task._id, data: taskData })
      lastSavedDataRef.current = currentDataStr
    } catch {
      // Silently fail - user can retry
    }
  }, [task, buildTaskData, updateTask, getValues])

  // Schedule auto-save (debounced)
  const scheduleAutoSave = useCallback(() => {
    if (!task) return

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      performAutoSave()
    }, 800)
  }, [task, performAutoSave])

  // Use subscription-based watch to trigger auto-save without re-renders
  useEffect(() => {
    if (!task || !isOpen) return

    const subscription = watch(() => {
      scheduleAutoSave()
    })

    return () => {
      subscription.unsubscribe()
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [watch, task, isOpen, scheduleAutoSave])

  // Validate metadata JSON and return parsed value or null if invalid
  const parseMetadataJson = useCallback((value: string): { valid: boolean; parsed: unknown; error: string | null } => {
    const trimmed = value.trim()
    if (!trimmed) {
      return { valid: true, parsed: {}, error: null }
    }

    try {
      const parsed = JSON.parse(trimmed)
      return { valid: true, parsed, error: null }
    } catch {
      return { valid: false, parsed: null, error: 'Invalid JSON' }
    }
  }, [])


  // Cleanup on close - perform pending save instead of cancelling it
  useEffect(() => {
    if (!isOpen) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
        // Perform the pending save immediately instead of cancelling
        performAutoSave()
      }
      setMetadataError(null)
      setIsMetadataEditMode(false)
    }
  }, [isOpen, performAutoSave])

  const onSubmit = async (data: Record<string, unknown>) => {
    // Validate title is required for create
    const title = data.title as string
    if (!task && (!title || !title.trim())) {
      // Title is required for new tasks - don't submit
      return
    }

    // Build task data from form values
    // Always include core fields, then process field config fields
    const taskData: Partial<Task> = {}

    // Process core fields first (these always exist in the form)
    const coreFields = Object.keys(coreDefaultValues)
    coreFields.forEach((field) => {
      const value = data[field]
      if (field === 'tags' && typeof value === 'string') {
        taskData[field as keyof Task] = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as never
      } else if (field === 'dueAt') {
        taskData[field as keyof Task] = (value ? new Date(value as string).toISOString() : null) as never
      } else if (field === 'workflowId' || field === 'assigneeId') {
        taskData[field as keyof Task] = (value || null) as never
      } else {
        taskData[field as keyof Task] = value as never
      }
    })

    // Then process any additional fields from field configs
    editableFields.forEach((fc) => {
      // Skip if already handled as a core field
      if (coreFields.includes(fc.fieldPath)) return

      const value = data[fc.fieldPath]

      if (fc.fieldType === 'tags' && typeof value === 'string') {
        taskData[fc.fieldPath as keyof Task] = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as never
      } else if (fc.fieldType === 'datetime' && value) {
        taskData[fc.fieldPath as keyof Task] = new Date(value as string).toISOString() as never
      } else if (fc.fieldType === 'datetime' && !value) {
        taskData[fc.fieldPath as keyof Task] = null as never
      } else if (fc.fieldType === 'reference') {
        taskData[fc.fieldPath as keyof Task] = (value || null) as never
      } else if (fc.fieldType === 'number' && value !== '') {
        taskData[fc.fieldPath as keyof Task] = Number(value) as never
      } else if (fc.fieldType === 'boolean') {
        taskData[fc.fieldPath as keyof Task] = Boolean(value) as never
      } else {
        taskData[fc.fieldPath as keyof Task] = value as never
      }
    })

    if (!task && parentTask) {
      taskData.parentId = parentTask._id
    }

    // Include webhookConfig if taskType is external
    if (taskData.taskType === 'external' && webhookConfig) {
      taskData.webhookConfig = webhookConfig
    }

    // Note: metadata is saved separately via its own Save button

    if (task) {
      await updateTask.mutateAsync({ id: task._id, data: taskData })
    } else {
      await createTask.mutateAsync(taskData)
    }

    onClose()
  }

  // Get current selected values for header display
  const currentStatus = watch('status') as string
  const currentUrgency = watch('urgency') as string
  const currentAssigneeId = watch('assigneeId') as string | null

  const currentStatusOption = statusOptions.find(s => s.code === currentStatus)
  const currentUrgencyOption = urgencyOptions.find(u => u.code === currentUrgency)
  const currentAssignee = users.find(u => u._id === currentAssigneeId)

  // Handle title blur - save on blur
  const handleTitleBlur = useCallback(() => {
    if (!task) return
    const title = getValues('title')
    if (title && title !== task.title) {
      performAutoSave()
    }
  }, [task, getValues, performAutoSave])

  // Get task type config for current type
  const currentTypeConfig = getTaskTypeConfig(currentTaskType)

  // Editable header with key fields for existing tasks
  const EditableHeader = () => {
    if (!task) return null

    return (
      <>
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-border/50">
        {/* Task Type - inline select with icon */}
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
                  // Initialize webhook config when switching to external type
                  if (val === 'external' && !webhookConfig) {
                    setWebhookConfig({
                      url: '',
                      method: 'POST',
                      maxRetries: 3,
                      retryDelayMs: 1000,
                      timeoutMs: 30000,
                    })
                  }
                }}
              >
                <SelectTrigger
                  className="h-7 w-auto gap-1.5 px-2 text-xs border-0 hover:bg-muted"
                  style={{
                    backgroundColor: `${typeConfig.hexColor}15`,
                    color: typeConfig.hexColor,
                  }}
                >
                  <TypeIcon className="h-3.5 w-3.5" />
                  <span>{typeConfig.label}</span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_TYPE_CONFIG)
                    .filter(([key]) => !['webhook', 'trigger'].includes(key)) // Filter out legacy/internal types
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

        {/* Status - inline select with immediate save */}
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <Select value={field.value as string || ''} onValueChange={(value) => {
              field.onChange(value)
              // Immediately save status changes - don't wait for debounce
              if (task) {
                updateTask.mutate({ id: task._id, data: { status: value } })
              }
            }}>
              <SelectTrigger
                className="h-7 w-auto gap-1.5 px-2 text-xs border-0 bg-transparent hover:bg-muted"
                style={currentStatusOption?.color ? {
                  backgroundColor: `${currentStatusOption.color}20`,
                  color: currentStatusOption.color,
                } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: currentStatusOption?.color || '#888' }}
                />
                <span>{currentStatusOption?.displayName || 'Status'}</span>
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: opt.color }}
                      />
                      {opt.displayName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />

        {/* Urgency - inline select */}
        <Controller
          name="urgency"
          control={control}
          render={({ field }) => (
            <Select value={field.value as string || ''} onValueChange={field.onChange}>
              <SelectTrigger
                className="h-7 w-auto gap-1.5 px-2 text-xs border-0 bg-transparent hover:bg-muted"
                style={currentUrgencyOption?.color ? {
                  backgroundColor: `${currentUrgencyOption.color}20`,
                  color: currentUrgencyOption.color,
                } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: currentUrgencyOption?.color || '#888' }}
                />
                <span>{currentUrgencyOption?.displayName || 'Urgency'}</span>
              </SelectTrigger>
              <SelectContent>
                {urgencyOptions.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: opt.color }}
                      />
                      {opt.displayName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />

        {/* Assignee - inline select */}
        <Controller
          name="assigneeId"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value as string || '_unassigned'}
              onValueChange={(val) => field.onChange(val === '_unassigned' ? null : val)}
            >
              <SelectTrigger className="h-7 w-auto gap-1.5 px-2 text-xs border-0 bg-transparent hover:bg-muted">
                {currentAssignee ? (
                  <>
                    <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium">
                      {currentAssignee.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span>{currentAssignee.displayName}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_unassigned">Unassigned</SelectItem>
                {users
                  .filter((user) => user._id && user.isActive)
                  .map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium">
                          {user.displayName.charAt(0).toUpperCase()}
                        </span>
                        {user.displayName}
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        />

        {/* Workflow Run Link - show when task is part of a workflow run */}
        {task.workflowRunId && (
          <Link
            href={`/workflow-runs?id=${task.workflowRunId}`}
            className="flex items-center gap-1.5 px-2 h-7 text-xs rounded-md bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
          >
            <Workflow className="h-3.5 w-3.5" />
            <span>Workflow Run</span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
        )}

        {/* Parent Task Link - show when task has a parent */}
        {task._resolved?.parent && (
          <button
            type="button"
            onClick={() => {
              onClose()
              router.push(`/tasks?taskId=${task._resolved!.parent!._id}`)
            }}
            className="flex items-center gap-1.5 px-2 h-7 text-xs rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors max-w-[200px]"
          >
            <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">Parent: {task._resolved.parent.title}</span>
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Timestamps - read only */}
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span title={format(new Date(task.createdAt), 'PPpp')}>
            Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
          </span>
          <span title={format(new Date(task.updatedAt), 'PPpp')}>
            Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Waiting indicator with reason (shown below header when task is waiting) */}
      {currentStatus === 'waiting' && (
        <div className="mt-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <span className="font-medium">Waiting</span>
            {(task as any).metadata?.waitingReason && (
              <>
                <span className="text-amber-400">•</span>
                <span>{(task as any).metadata.waitingReason}</span>
              </>
            )}
            {(task as any).taskType === 'foreach' && (task as any).batchCounters && (
              <span className="ml-auto font-mono text-xs">
                {(task as any).batchCounters.processedCount || 0}/{(task as any).batchCounters.expectedCount || '?'} processed
                {(task as any).batchCounters.failedCount > 0 && (
                  <span className="text-red-600 dark:text-red-400 ml-1">
                    ({(task as any).batchCounters.failedCount} failed)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
      </>
    )
  }

  // Form content - without the fields that are now in the header
  const FormContent = ({ isEditMode = false }: { isEditMode?: boolean }) => (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {/* Title - only show in create mode (edit mode has title in header) */}
        {!isEditMode && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Title *</label>
            <Input
              {...register('title')}
              ref={(e) => {
                register('title').ref(e)
                titleInputRef.current = e
              }}
              placeholder="Task title"
              className="h-8 text-sm"
            />
          </div>
        )}

        {/* Summary */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Summary</label>
          <textarea
            {...register('summary')}
            placeholder="Brief description..."
            rows={2}
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
              'placeholder:text-muted-foreground resize-none transition-colors',
              'focus-visible:outline-none focus-visible:border-primary'
            )}
          />
        </div>

        {/* Extra Prompt - only for agent tasks */}
        {currentTaskType === 'agent' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Extra Prompt</label>
            <textarea
              {...register('extraPrompt')}
              placeholder="Additional prompt context..."
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
                'placeholder:text-muted-foreground resize-none transition-colors',
                'focus-visible:outline-none focus-visible:border-primary'
              )}
            />
          </div>
        )}

        {/* Additional Info - hidden for standard tasks in edit mode (moved to sidebar) */}
        {!(isEditMode && currentTaskType === 'standard') && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Additional Info</label>
            <textarea
              {...register('additionalInfo')}
              placeholder="Any other relevant information..."
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
                'placeholder:text-muted-foreground resize-none transition-colors',
                'focus-visible:outline-none focus-visible:border-primary'
              )}
            />
          </div>
        )}

        {/* Status & Urgency - only show in create mode */}
        {!isEditMode && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value as string || ''} onValueChange={field.onChange}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: opt.color }}
                            />
                            {opt.displayName}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Urgency</label>
              <Controller
                name="urgency"
                control={control}
                render={({ field }) => (
                  <Select value={field.value as string || ''} onValueChange={field.onChange}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select urgency" />
                    </SelectTrigger>
                    <SelectContent>
                      {urgencyOptions.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: opt.color }}
                            />
                            {opt.displayName}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
        )}

        {/* Workflow & Stage */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Workflow</label>
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
                  <SelectTrigger className="h-8 text-sm">
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

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Stage</label>
            <Controller
              name="workflowStage"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || '_none'}
                  onValueChange={(val) => field.onChange(val === '_none' ? '' : val)}
                  disabled={!selectedWorkflowId || workflowStages.length === 0}
                >
                  <SelectTrigger className="h-8 text-sm">
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

        {/* Assignee & Due Date - only show assignee in create mode */}
        <div className="grid grid-cols-2 gap-2">
          {!isEditMode && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Assignee</label>
              <Controller
                name="assigneeId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value as string || '_unassigned'}
                    onValueChange={(val) => field.onChange(val === '_unassigned' ? null : val)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_unassigned">Unassigned</SelectItem>
                      {users
                        .filter((user) => user._id && user.isActive)
                        .map((user) => (
                          <SelectItem key={user._id} value={user._id}>
                            <div className="flex items-center gap-2">
                              <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium">
                                {user.displayName.charAt(0).toUpperCase()}
                              </span>
                              {user.displayName}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          <div className={cn('space-y-1', isEditMode && 'col-span-2')}>
            <label className="text-xs font-medium text-muted-foreground">Due Date</label>
            <Input
              type="datetime-local"
              {...register('dueAt')}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Tags</label>
          <Input
            {...register('tags')}
            placeholder="tag1, tag2, tag3"
            className="h-8 text-sm"
          />
        </div>

        {/* Task Type selector - only show in create mode (edit mode has it in header) */}
        {!isEditMode && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Task Type</label>
            <Controller
              name="taskType"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || 'agent'}
                  onValueChange={(val) => {
                    field.onChange(val)
                    // Initialize webhook config when switching to external type
                    if (val === 'external' && !webhookConfig) {
                      setWebhookConfig({
                        url: '',
                        method: 'POST',
                        maxRetries: 3,
                        retryDelayMs: 1000,
                        timeoutMs: 30000,
                      })
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TASK_TYPE_CONFIG)
                      .filter(([key]) => !['webhook', 'trigger'].includes(key)) // Filter out legacy/internal types
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
              )}
            />
          </div>
        )}

        {/* Webhook Configuration - only in create mode (edit mode moves to sidebar) */}
        {currentTaskType === 'external' && !isEditMode && (
          <WebhookTaskConfig
            task={task}
            isEditMode={isEditMode}
            webhookConfig={webhookConfig}
            onConfigChange={(config) => {
              setWebhookConfig(config)
            }}
          />
        )}

        {/* Parent Task (for subtask creation) */}
        {!task && parentTask && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Parent Task</label>
            <div className="px-3 py-1.5 text-sm bg-muted rounded-md border">
              {parentTask.title}
            </div>
          </div>
        )}
      </div>

      {/* Footer - only show in create mode */}
      {!isEditMode && (
        <DialogFooter className="pt-3 mt-3 border-t flex-shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      )}
    </form>
  )

  // Create mode - single column, compact
  if (!task) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="pb-2 flex-shrink-0">
            <DialogTitle className="text-base">
              {parentTask ? `New Subtask` : 'New Task'}
            </DialogTitle>
            {parentTask && (
              <p className="text-xs text-muted-foreground">
                Under: {parentTask.title}
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <FormContent isEditMode={false} />
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Type-specific configuration content for sidebar
  const TypeConfigContent = () => {
    const typeConfig = getTaskTypeConfig(currentTaskType)
    const TypeIcon = typeConfig.icon

    return (
      <div className="p-4 space-y-4">
        {/* Task type display (selector is in header) */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Task Type</label>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-md border"
            style={{
              backgroundColor: `${typeConfig.hexColor}10`,
              borderColor: `${typeConfig.hexColor}30`,
            }}
          >
            <TypeIcon className="h-4 w-4" style={{ color: typeConfig.hexColor }} />
            <span className="text-sm font-medium" style={{ color: typeConfig.hexColor }}>{typeConfig.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{typeConfig.description}</p>
        </div>

        {/* Webhook Configuration - show when taskType is external */}
        {currentTaskType === 'external' && (
          <WebhookTaskConfig
            task={task}
            isEditMode={true}
            webhookConfig={webhookConfig}
            onConfigChange={(config) => {
              setWebhookConfig(config)
              // Auto-save webhook config changes for existing tasks
              if (task) {
                updateTask.mutateAsync({
                  id: task._id,
                  data: { webhookConfig: config },
                })
              }
            }}
          />
        )}

        {/* ForEach Configuration - show when taskType is foreach */}
        {currentTaskType === 'foreach' && task && (
          <div className="space-y-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
            <label className="text-xs font-medium text-green-800 dark:text-green-200">Batch Progress</label>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Expected Subtasks</label>
                <Input
                  type="number"
                  min="0"
                  className="h-7 text-sm"
                  defaultValue={(task as any).batchCounters?.expectedCount || 0}
                  onBlur={(e) => {
                    const newValue = parseInt(e.target.value, 10) || 0
                    const currentCounters = (task as any).batchCounters || {}
                    if (newValue !== currentCounters.expectedCount) {
                      updateTask.mutateAsync({
                        id: task._id,
                        data: {
                          batchCounters: {
                            ...currentCounters,
                            expectedCount: newValue,
                          },
                        },
                      })
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Processed</label>
                  <div className="h-7 px-3 py-1 text-sm bg-muted rounded-md border flex items-center">
                    {(task as any).batchCounters?.processedCount || 0}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Failed</label>
                  <div className={cn(
                    "h-7 px-3 py-1 text-sm rounded-md border flex items-center",
                    ((task as any).batchCounters?.failedCount || 0) > 0
                      ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"
                      : "bg-muted"
                  )}>
                    {(task as any).batchCounters?.failedCount || 0}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Waiting for {(task as any).batchCounters?.expectedCount || '?'} subtasks to complete.
            </p>
          </div>
        )}

        {/* Agent task - extra prompt field */}
        {currentTaskType === 'agent' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground italic">
              Agent tasks are executed by AI agents using the extra prompt.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Extra Prompt</label>
              <textarea
                {...register('extraPrompt')}
                placeholder="Additional prompt context for AI agent..."
                rows={4}
                className={cn(
                  'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
                  'placeholder:text-muted-foreground resize-none transition-colors',
                  'focus-visible:outline-none focus-visible:border-primary'
                )}
              />
            </div>
          </div>
        )}

        {/* Flow task - workflow parent */}
        {currentTaskType === 'flow' && (
          <p className="text-xs text-muted-foreground italic">
            Flow tasks are workflow parent tasks that contain workflow steps.
          </p>
        )}

        {/* Manual task - human review */}
        {currentTaskType === 'manual' && (
          <p className="text-xs text-muted-foreground italic">
            Manual tasks require human review and action to complete.
          </p>
        )}

        {/* Decision task */}
        {currentTaskType === 'decision' && (
          <p className="text-xs text-muted-foreground italic">
            Decision tasks route based on conditions from previous step output.
          </p>
        )}

        {/* Join task */}
        {currentTaskType === 'join' && (
          <p className="text-xs text-muted-foreground italic">
            Join tasks aggregate results from multiple parallel tasks.
          </p>
        )}

        {/* Flow task (nested workflow) */}
        {currentTaskType === 'flow' && (
          <p className="text-xs text-muted-foreground italic">
            Flow tasks delegate to another workflow.
          </p>
        )}
      </div>
    )
  }

  // Metadata content for sidebar
  const MetadataContent = () => (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Task Metadata</label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px]"
          onClick={() => {
            if (!isMetadataEditMode) {
              // Switching to edit mode - store the initial value
              const initialValue = JSON.stringify(task?.metadata || {}, null, 2)
              savedMetadataValueRef.current = initialValue
              currentMetadataValueRef.current = initialValue
              setMetadataError(null)
              // Set textarea value after it mounts
              setTimeout(() => {
                if (metadataTextareaRef.current) {
                  metadataTextareaRef.current.value = initialValue
                }
              }, 0)
            }
            setIsMetadataEditMode(!isMetadataEditMode)
          }}
        >
          {isMetadataEditMode ? 'View' : 'Edit'}
        </Button>
      </div>

      {isMetadataEditMode ? (
        // Edit mode - uncontrolled JSON textarea (ref-based to avoid re-render lag)
        <div className="space-y-1">
          <textarea
            ref={metadataTextareaRef}
            onInput={(e) => {
              currentMetadataValueRef.current = (e.target as HTMLTextAreaElement).value
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
              }
            }}
            placeholder='{"key": "value"}'
            rows={12}
            className={cn(
              'flex w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono',
              'placeholder:text-muted-foreground resize-y transition-colors',
              'focus-visible:outline-none',
              metadataError
                ? 'border-destructive focus-visible:border-destructive'
                : 'border-input focus-visible:border-primary'
            )}
          />
          <div className="flex items-center justify-between">
            {metadataError ? (
              <p className="text-[10px] text-destructive">{metadataError}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">&nbsp;</p>
            )}
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  currentMetadataValueRef.current = savedMetadataValueRef.current
                  if (metadataTextareaRef.current) {
                    metadataTextareaRef.current.value = savedMetadataValueRef.current
                  }
                  setMetadataError(null)
                  setTimeout(() => {
                    if (metadataTextareaRef.current) {
                      metadataTextareaRef.current.value = currentMetadataValueRef.current
                    }
                  }, 0)
                }}
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={async () => {
                  if (!task) return
                  const currentValue = currentMetadataValueRef.current
                  const { valid, parsed, error } = parseMetadataJson(currentValue)
                  setMetadataError(error)
                  setTimeout(() => {
                    if (metadataTextareaRef.current) {
                      metadataTextareaRef.current.value = currentMetadataValueRef.current
                    }
                  }, 0)
                  if (!valid) return
                  try {
                    await updateTask.mutateAsync({ id: task._id, data: { metadata: parsed as Record<string, unknown> } })
                    savedMetadataValueRef.current = currentValue
                    setIsMetadataEditMode(false)
                  } catch {
                    // Silently fail
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        // View mode - collapsible tree view
        <div className="px-3 py-2 text-sm bg-muted/50 rounded-md border max-h-[calc(100vh-300px)] overflow-y-auto">
          <JsonViewer
            data={task?.metadata}
            defaultExpanded={true}
            maxInitialDepth={2}
          />
        </div>
      )}
    </div>
  )

  // Edit mode - two column layout with tabbed sidebar
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Accessibility: visually hidden title */}
        <span className="sr-only">Edit Task</span>

        {/* Header - fixed, with border that connects to columns */}
        <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-border">
          {/* Editable title with underline style */}
          <input
            {...register('title', {
              onBlur: handleTitleBlur,
            })}
            placeholder="Task title..."
            className={cn(
              'w-full text-lg font-semibold bg-transparent pr-8',
              'border-0 border-b-2 border-transparent rounded-none',
              'hover:border-muted-foreground/30 focus:border-primary',
              'focus:outline-none focus:ring-0',
              'transition-colors duration-150',
              'placeholder:text-muted-foreground/50'
            )}
          />
          <div className="mt-3">
            <EditableHeader />
          </div>
        </div>

        {/* Two-column content - flush with header border */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left column - Form */}
          <div className="flex-1 px-5 py-4 flex flex-col min-h-0 border-r border-border overflow-y-auto">
            <FormContent isEditMode={true} />
          </div>

          {/* Right column - Tabbed sidebar */}
          <div className="w-[420px] flex-shrink-0 flex flex-col min-h-0 bg-muted/20">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
              <TabsList className="flex-shrink-0 w-full justify-start rounded-none border-b border-border bg-background/50 p-0 h-auto">
                <TabsTrigger
                  value={TASK_MODAL_TABS.TYPE_CONFIG}
                  className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-xs">Config</span>
                </TabsTrigger>
                <TabsTrigger
                  value={TASK_MODAL_TABS.FILES}
                  className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="text-xs">Files</span>
                </TabsTrigger>
                <TabsTrigger
                  value={TASK_MODAL_TABS.METADATA}
                  className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span className="text-xs">Metadata</span>
                </TabsTrigger>
                <TabsTrigger
                  value={TASK_MODAL_TABS.ACTIVITY}
                  className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5"
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span className="text-xs">Activity</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value={TASK_MODAL_TABS.TYPE_CONFIG} className="flex-1 min-h-0 overflow-y-auto mt-0">
                <TypeConfigContent />
              </TabsContent>

              <TabsContent value={TASK_MODAL_TABS.FILES} className="flex-1 min-h-0 overflow-y-auto mt-0">
                <TaskFiles taskId={task._id} className="h-full" compact />
              </TabsContent>

              <TabsContent value={TASK_MODAL_TABS.METADATA} className="flex-1 min-h-0 overflow-y-auto mt-0">
                <MetadataContent />
              </TabsContent>

              <TabsContent value={TASK_MODAL_TABS.ACTIVITY} className="flex-1 min-h-0 overflow-y-auto mt-0">
                <TaskActivity taskId={task._id} className="h-full" compact />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
