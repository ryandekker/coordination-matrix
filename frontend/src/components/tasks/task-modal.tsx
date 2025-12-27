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
import { useCreateTask, useUpdateTask, useRerunTask, useUsers, useWorkflows, useTasks, useTaskChildren } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import { TaskActivity } from './task-activity'
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
import { Settings2, Database, Activity, Workflow, ExternalLink, ArrowUpRight, ListTree, Plus, Loader2, RotateCcw } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserChip, UserAvatar } from '@/components/ui/user-chip'
import { TagInput } from '@/components/ui/tag-input'

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

  // Subtask creation state (at parent level to maintain focus across re-renders)
  const subtaskInputRef = useRef<HTMLInputElement>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false)

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
  const rerunTask = useRerunTask()

  // Only fetch users and workflows when modal is open
  const { data: usersData } = useUsers()
  const { data: workflowsData } = useWorkflows()

  // Only fetch tasks list for parent task selector when editing (not creating)
  // This significantly reduces unnecessary data fetching
  const { data: tasksData } = useTasks({
    limit: 50,
    enabled: isOpen && !!task // Only fetch when editing an existing task
  })

  // Fetch subtasks for the current task
  const { data: childrenData, isLoading: isLoadingChildren } = useTaskChildren(
    isOpen && task ? task._id : null
  )

  const users = usersData?.data || []
  const workflows = workflowsData?.data || []
  const allTasks = tasksData?.data || []
  const subtasks = childrenData?.data || []

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
    status: 'pending',
    urgency: 'normal',
    workflowId: null,
    workflowStage: '',
    assigneeId: null,
    dueAt: null,
    tags: [] as string[],
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
            values[fc.fieldPath] = []
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
        if (field === 'tags') {
          // Keep tags as array
          values[field] = Array.isArray(value) ? value : []
        } else if (field === 'dueAt' && value) {
          values[field] = new Date(value as string).toISOString().slice(0, 16)
        } else {
          values[field] = value ?? coreDefaultValues[field]
        }
      })

      // Then load editable fields (may override some core fields)
      editableFields.forEach((fc) => {
        const value = (task as unknown as Record<string, unknown>)[fc.fieldPath]
        if (fc.fieldType === 'tags') {
          // Keep tags as array
          values[fc.fieldPath] = Array.isArray(value) ? value : []
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

    // Process core fields first (header fields like status, urgency, assigneeId)
    const coreFields = Object.keys(coreDefaultValues)
    coreFields.forEach((field) => {
      const value = data[field]
      if (field === 'tags') {
        // Tags are now stored as array directly
        taskData[field as keyof Task] = (Array.isArray(value) ? value : []) as never
      } else if (field === 'dueAt') {
        taskData[field as keyof Task] = (value ? new Date(value as string).toISOString() : null) as never
      } else if (field === 'workflowId' || field === 'assigneeId') {
        taskData[field as keyof Task] = (value || null) as never
      } else {
        taskData[field as keyof Task] = value as never
      }
    })

    // Then process additional fields from field configs (skip if already handled)
    editableFields.forEach((fc) => {
      if (coreFields.includes(fc.fieldPath)) return

      const value = data[fc.fieldPath]

      if (fc.fieldType === 'tags') {
        // Tags are now stored as array directly
        taskData[fc.fieldPath as keyof Task] = (Array.isArray(value) ? value : []) as never
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
      // Reset subtask input
      setNewSubtaskTitle('')
      setIsCreatingSubtask(false)
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
      if (field === 'tags') {
        // Tags are now stored as array directly
        taskData[field as keyof Task] = (Array.isArray(value) ? value : []) as never
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

      if (fc.fieldType === 'tags') {
        // Tags are now stored as array directly
        taskData[fc.fieldPath as keyof Task] = (Array.isArray(value) ? value : []) as never
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

  // Handle creating a new subtask (defined here before early return to satisfy hooks rules)
  const handleCreateSubtask = useCallback(async () => {
    if (!newSubtaskTitle.trim() || !task) return

    setIsCreatingSubtask(true)
    try {
      await createTask.mutateAsync({
        title: newSubtaskTitle.trim(),
        parentId: task._id,
        status: 'pending',
        taskType: 'agent',
      })
      setNewSubtaskTitle('')
    } finally {
      setIsCreatingSubtask(false)
      // Refocus input after React finishes re-rendering
      setTimeout(() => {
        subtaskInputRef.current?.focus()
      }, 0)
    }
  }, [newSubtaskTitle, task, createTask])

  // Handle keydown in subtask input
  const handleSubtaskInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreateSubtask()
    }
  }, [handleCreateSubtask])

  // Handle clicking on a subtask to navigate to it
  const handleSubtaskClick = useCallback((subtaskId: string) => {
    router.push(`/tasks?taskId=${subtaskId}`, { scroll: false })
  }, [router])

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

        {/* Urgency - inline select with immediate save */}
        <Controller
          name="urgency"
          control={control}
          render={({ field }) => (
            <Select value={field.value as string || ''} onValueChange={(value) => {
              field.onChange(value)
              // Immediately save urgency changes - don't wait for debounce
              if (task) {
                updateTask.mutate({ id: task._id, data: { urgency: value } })
              }
            }}>
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

        {/* Assignee - inline select with immediate save */}
        <Controller
          name="assigneeId"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value as string || '_unassigned'}
              onValueChange={(val) => {
                const newValue = val === '_unassigned' ? null : val
                field.onChange(newValue)
                // Immediately save assignee changes - don't wait for debounce
                if (task) {
                  updateTask.mutate({ id: task._id, data: { assigneeId: newValue } })
                }
              }}
            >
              <SelectTrigger className="h-7 w-auto gap-0 px-0.5 text-xs border-0 bg-transparent hover:bg-muted">
                <UserChip user={currentAssignee} size="sm" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_unassigned">
                  <UserChip user={null} size="sm" />
                </SelectItem>
                {users
                  .filter((user) => user._id && user.isActive)
                  .map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      <UserChip user={user} size="sm" />
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
              router.push(`/tasks?parentId=${task._resolved!.parent!._id}`)
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

        {/* Extra Prompt - only for agent tasks in create mode (edit mode shows in sidebar) */}
        {!isEditMode && currentTaskType === 'agent' && (
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
                      <SelectItem value="_unassigned">
                        <UserChip user={null} size="sm" />
                      </SelectItem>
                      {users
                        .filter((user) => user._id && user.isActive)
                        .map((user) => (
                          <SelectItem key={user._id} value={user._id}>
                            <UserChip user={user} size="sm" />
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

    // Can rerun if task has completed, failed, or is part of a workflow run
    const canRerun = task && (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      task.workflowRunId
    )

    const handleRerun = async () => {
      if (!task) return
      try {
        await rerunTask.mutateAsync({ id: task._id })
      } catch (error) {
        console.error('Failed to rerun task:', error)
      }
    }

    return (
      <div className="p-4 space-y-4">
        {/* Rerun button - show for tasks that can be rerun */}
        {canRerun && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleRerun}
            disabled={rerunTask.isPending || task?.status === 'pending'}
          >
            <RotateCcw className={cn("h-4 w-4", rerunTask.isPending && "animate-spin")} />
            {rerunTask.isPending ? 'Rerunning...' : 'Rerun Task'}
          </Button>
        )}

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

        {/* Join task configuration */}
        {currentTaskType === 'join' && task && (
          <div className="space-y-3 p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg">
            <label className="text-xs font-medium text-indigo-800 dark:text-indigo-200">Join Configuration</label>
            <p className="text-[10px] text-muted-foreground">
              Aggregates results from multiple parallel tasks.
            </p>

            {/* Join progress display */}
            {task.metadata && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Success Count</label>
                  <div className="h-7 px-3 py-1 text-sm bg-muted rounded-md border flex items-center">
                    {(task.metadata as any).successCount ?? '-'} / {(task.metadata as any).expectedCount ?? '?'}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Success %</label>
                  <div className={cn(
                    "h-7 px-3 py-1 text-sm rounded-md border flex items-center",
                    ((task.metadata as any).successPercent ?? 100) >= ((task.metadata as any).requiredPercent ?? 100)
                      ? "bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400"
                      : "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400"
                  )}>
                    {((task.metadata as any).successPercent ?? 0).toFixed(1)}% / {(task.metadata as any).requiredPercent ?? 100}%
                  </div>
                </div>
              </div>
            )}

            {/* Editable join configuration */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-700">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Expected Count</label>
                <Input
                  type="number"
                  min="0"
                  className="h-7 text-sm"
                  defaultValue={(task as any).joinConfig?.expectedCount ?? ''}
                  placeholder="Auto"
                  onBlur={(e) => {
                    const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                    const currentConfig = (task as any).joinConfig || {}
                    updateTask.mutateAsync({
                      id: task._id,
                      data: {
                        joinConfig: {
                          ...currentConfig,
                          expectedCount: newValue,
                        },
                      },
                    })
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Max Wait (ms)</label>
                <Input
                  type="number"
                  min="0"
                  className="h-7 text-sm"
                  defaultValue={(task as any).joinConfig?.boundary?.maxWaitMs ?? ''}
                  placeholder="No timeout"
                  onBlur={(e) => {
                    const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                    const currentConfig = (task as any).joinConfig || {}
                    updateTask.mutateAsync({
                      id: task._id,
                      data: {
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

            {/* Min thresholds only shown when expected count is set */}
            {(task as any).joinConfig?.expectedCount != null && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Min Success %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    className="h-7 text-sm"
                    defaultValue={(task as any).joinConfig?.minSuccessPercent ?? (task as any).joinConfig?.boundary?.minPercent ?? ''}
                    placeholder="100"
                    onBlur={(e) => {
                      const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                      const currentConfig = (task as any).joinConfig || {}
                      updateTask.mutateAsync({
                        id: task._id,
                        data: {
                          joinConfig: {
                            ...currentConfig,
                            minSuccessPercent: newValue,
                            boundary: {
                              ...currentConfig.boundary,
                              minPercent: newValue,
                            },
                          },
                        },
                      })
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Min Count</label>
                  <Input
                    type="number"
                    min="0"
                    className="h-7 text-sm"
                    defaultValue={(task as any).joinConfig?.boundary?.minCount ?? ''}
                    placeholder="All"
                    onBlur={(e) => {
                      const newValue = e.target.value ? parseInt(e.target.value, 10) : undefined
                      const currentConfig = (task as any).joinConfig || {}
                      updateTask.mutateAsync({
                        id: task._id,
                        data: {
                          joinConfig: {
                            ...currentConfig,
                            boundary: {
                              ...currentConfig.boundary,
                              minCount: newValue,
                            },
                          },
                        },
                      })
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Join task simple display (when not a join task but task doesn't exist) */}
        {currentTaskType === 'join' && !task && (
          <p className="text-xs text-muted-foreground italic">
            Join tasks aggregate results from multiple parallel tasks.
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
                  value={TASK_MODAL_TABS.SUBTASKS}
                  className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5"
                >
                  <ListTree className="h-3.5 w-3.5" />
                  <span className="text-xs">Subtasks</span>
                  {subtasks.length > 0 && (
                    <span className="ml-0.5 text-[10px] bg-muted px-1 rounded">{subtasks.length}</span>
                  )}
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

              <TabsContent value={TASK_MODAL_TABS.SUBTASKS} className="flex-1 min-h-0 overflow-y-auto mt-0">
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      Subtasks {subtasks.length > 0 && `(${subtasks.length})`}
                    </label>
                  </div>

                  {/* Quick create input */}
                  <div className="relative">
                    <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      ref={subtaskInputRef}
                      type="text"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={handleSubtaskInputKeyDown}
                      placeholder="Add subtask... (Enter to create)"
                      disabled={isCreatingSubtask}
                      className={cn(
                        'w-full h-8 pl-8 pr-8 text-sm rounded-md border border-input bg-background',
                        'placeholder:text-muted-foreground/60',
                        'focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    />
                    {isCreatingSubtask && (
                      <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
                    )}
                  </div>

                  {isLoadingChildren ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <span className="text-sm">Loading subtasks...</span>
                    </div>
                  ) : subtasks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                      <ListTree className="h-6 w-6 mb-1.5 opacity-50" />
                      <span className="text-xs">No subtasks yet</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {subtasks.map((subtask) => {
                        const subtaskStatus = statusOptions.find(s => s.code === subtask.status)
                        const subtaskAssignee = users.find(u => u._id === subtask.assigneeId)
                        const subtaskTypeConfig = getTaskTypeConfig(subtask.taskType)
                        const SubtaskTypeIcon = subtaskTypeConfig.icon

                        return (
                          <button
                            key={subtask._id}
                            type="button"
                            onClick={() => handleSubtaskClick(subtask._id)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left',
                              'bg-muted/30 hover:bg-muted/60 transition-colors',
                              'border border-transparent hover:border-border'
                            )}
                          >
                            {/* Task type icon */}
                            <SubtaskTypeIcon
                              className="h-3.5 w-3.5 flex-shrink-0"
                              style={{ color: subtaskTypeConfig.hexColor }}
                            />

                            {/* Status badge */}
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
                              style={{
                                backgroundColor: `${subtaskStatus?.color || '#888'}20`,
                                color: subtaskStatus?.color || '#888',
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: subtaskStatus?.color || '#888' }}
                              />
                              {subtaskStatus?.displayName || subtask.status}
                            </span>

                            {/* Title */}
                            <span className="flex-1 text-sm truncate" title={subtask.title}>
                              {subtask.title}
                            </span>

                            {/* Assignee avatar with tooltip */}
                            {subtaskAssignee ? (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium flex-shrink-0 cursor-default"
                                    >
                                      {subtaskAssignee.displayName.charAt(0).toUpperCase()}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="text-xs">
                                    {subtaskAssignee.displayName}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="w-5 h-5 flex-shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
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
