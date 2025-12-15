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
import { Task, FieldConfig, LookupValue } from '@/lib/api'
import { useCreateTask, useUpdateTask, useUsers, useWorkflows, useTasks } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import { TaskActivity } from './task-activity'

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
  const queryClient = useQueryClient()
  const prevIsOpenRef = useRef(false)
  const [isMetadataEditMode, setIsMetadataEditMode] = useState(false)
  const metadataTextareaRef = useRef<HTMLTextAreaElement>(null)

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
    } else {
      const values = { ...defaultValues }
      if (parentTask) {
        values.parentId = parentTask._id
      }
      reset(values)
      lastSavedDataRef.current = ''
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

      // Include metadata if in edit mode
      if (metadataTextareaRef.current) {
        try {
          const jsonValue = metadataTextareaRef.current.value.trim()
          if (jsonValue) {
            const parsed = JSON.parse(jsonValue)
            if (typeof parsed === 'object' && !Array.isArray(parsed)) {
              taskData.metadata = parsed
            }
          }
        } catch {
          // Invalid JSON - skip metadata update
        }
      }

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

  // Cleanup on close
  useEffect(() => {
    if (!isOpen && autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }
  }, [isOpen])

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

    // Include metadata from the textarea if in edit mode
    if (task && metadataTextareaRef.current) {
      try {
        const jsonValue = metadataTextareaRef.current.value.trim()
        if (jsonValue) {
          const parsed = JSON.parse(jsonValue)
          if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            taskData.metadata = parsed
          }
        }
      } catch {
        // Invalid JSON - don't include metadata update, let form submit continue
        // The validation will show on next edit attempt
      }
    }

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

  // Editable header with key fields for existing tasks
  const EditableHeader = () => {
    if (!task) return null

    return (
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-border/50">
        {/* Status - inline select */}
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <Select value={field.value as string || ''} onValueChange={field.onChange}>
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
            <Input {...register('title')} placeholder="Task title" className="h-8 text-sm" />
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
              'ring-offset-background placeholder:text-muted-foreground resize-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
            )}
          />
        </div>

        {/* Extra Prompt */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Extra Prompt</label>
          <textarea
            {...register('extraPrompt')}
            placeholder="Additional prompt context..."
            rows={2}
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
              'ring-offset-background placeholder:text-muted-foreground resize-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
            )}
          />
        </div>

        {/* Additional Info */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Additional Info</label>
          <textarea
            {...register('additionalInfo')}
            placeholder="Any other relevant information..."
            rows={2}
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
              'ring-offset-background placeholder:text-muted-foreground resize-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
            )}
          />
        </div>

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

        {/* Metadata - toggleable between visual and edit modes */}
        {isEditMode && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Metadata</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px]"
onClick={() => {
                  if (!isMetadataEditMode) {
                    // Switching to edit mode - populate textarea after render
                    setTimeout(() => {
                      if (metadataTextareaRef.current) {
                        metadataTextareaRef.current.value = JSON.stringify(task?.metadata || {}, null, 2)
                        metadataTextareaRef.current.focus()
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
              // Edit mode - JSON textarea (uncontrolled to prevent cursor issues)
              // Saves automatically when the main form Update button is clicked
              <div className="space-y-1">
                <textarea
                  ref={metadataTextareaRef}
                  defaultValue={JSON.stringify(task?.metadata || {}, null, 2)}
                  onKeyDown={(e) => {
                    // Prevent form submission on Enter
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                    }
                  }}
                  placeholder='{"key": "value"}'
                  rows={6}
                  className={cn(
                    'flex w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono',
                    'ring-offset-background placeholder:text-muted-foreground resize-y',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'border-input'
                  )}
                />
                <p className="text-[10px] text-muted-foreground">Changes auto-save after 1 second</p>
              </div>
            ) : (
              // View mode - key-value display
              <div className="px-3 py-2 text-sm bg-muted/50 rounded-md border space-y-1.5 max-h-40 overflow-y-auto">
                {task?.metadata && Object.keys(task.metadata).length > 0 ? (
                  Object.entries(task.metadata).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-xs font-medium text-muted-foreground min-w-[80px]">{key}:</span>
                      <span className="text-xs break-all">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground italic">No metadata</span>
                )}
              </div>
            )}
          </div>
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

  // Edit mode - two column layout with integrated activity
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Accessibility: visually hidden title */}
        <span className="sr-only">Edit Task</span>

        {/* Header - fixed */}
        <div className="px-5 pt-5 pb-3 flex-shrink-0">
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

        {/* Two-column content - both scrollable */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left column - Form */}
          <div className="flex-1 px-5 pb-5 flex flex-col min-h-0 border-r border-border overflow-y-auto">
            <FormContent isEditMode={true} />
          </div>

          {/* Right column - Activity Feed */}
          <div className="w-96 flex-shrink-0 flex flex-col min-h-0 bg-muted/30">
            <div className="px-4 py-2 border-b border-border bg-background/50 flex-shrink-0">
              <h3 className="text-sm font-medium">Activity</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TaskActivity taskId={task._id} className="h-full" compact />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
