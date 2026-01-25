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
import { Task, FieldConfig, LookupValue, TaskType, WebhookConfig, isSystemUser } from '@/lib/api'
import { toast } from 'sonner'
import { useCreateTask, useUpdateTask, useRerunTask, useUsers, useWorkflows, useTasks, useTask, useTaskChildren, useTaskDocuments, useDetachDocument } from '@/hooks/use-tasks'
import { useGroupContext } from '@/lib/group-context'
import { cn } from '@/lib/utils'
import { TaskActivity } from './task-activity'
import { WebhookTaskConfig } from './webhook-task-config'
import { FlowTaskConfig, FlowConfig } from './flow-task-config'
import {
  TASK_TYPE_CONFIG,
  getTaskTypeConfig,
  TASK_MODAL_TAB_KEY,
  TASK_MODAL_TABS,
  getSmartDefaultTab,
  type TaskModalTab,
} from '@/lib/task-type-config'
import { Activity, Workflow, ExternalLink, ListTree, FileText, FileOutput, Settings, Braces, Settings2, Users, FolderKanban } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { UserChip } from '@/components/ui/user-chip'
import { TagInput } from '@/components/ui/tag-input'
import { TemplateTextarea } from '@/components/ui/template-textarea'
import {
  SubtasksList,
  AttachedDocuments,
  StatusPanel,
  OutputTab,
  DetailsTab,
  MetadataTab,
  StepConfigTab,
} from './task-modal/index'

interface TaskModalProps {
  task: Task | null
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  parentTask?: Task | null
  onClose: () => void
}

export function TaskModal({
  task: taskProp,
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
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig | undefined>(undefined)
  const [flowConfig, setFlowConfig] = useState<FlowConfig | undefined>(undefined)

  // Subtask creation state
  const subtaskInputRef = useRef<HTMLInputElement>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [isCreatingSubtask, setIsCreatingSubtask] = useState(false)

  // Webhook execution state
  const [isExecutingWebhook, setIsExecutingWebhook] = useState(false)
  const [isRetryingWebhook, setIsRetryingWebhook] = useState(false)

  // Auto-save refs
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedDataRef = useRef<string>('')
  const webhookSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const rerunTask = useRerunTask()

  // Metadata save handler
  const handleMetadataSave = useCallback(async (parsed: Record<string, unknown>) => {
    if (!taskProp) return
    await updateTask.mutateAsync({ id: taskProp._id, data: { metadata: parsed } })
  }, [taskProp, updateTask])

  // Fetch fresh task data when modal is open
  const { data: freshTaskData } = useTask(isOpen && taskProp ? taskProp._id : null)
  const task = freshTaskData?.data || taskProp

  // Fetch users and workflows
  const { data: usersData } = useUsers()
  const { data: workflowsData } = useWorkflows()

  // Fetch tasks for parent selector (only in edit mode)
  const { data: tasksData } = useTasks({
    limit: 50,
    enabled: isOpen && !!task
  })

  // Fetch subtasks
  const { data: childrenData, isLoading: isLoadingChildren } = useTaskChildren(
    isOpen && task ? task._id : null
  )

  // Fetch documents
  const { data: documentsData, isLoading: isLoadingDocuments } = useTaskDocuments(
    isOpen && task ? task._id : null
  )
  const detachDocument = useDetachDocument()

  const users = usersData?.data || []
  const workflows = workflowsData?.data || []
  const allTasks = tasksData?.data || []
  const subtasks = childrenData?.data || []
  const attachedDocuments = documentsData?.data || []

  const statusOptions = lookups['task_status'] || []
  const urgencyOptions = lookups['urgency'] || []

  // Right sidebar tab state - smart default based on task status and content
  const [activeTab, setActiveTab] = useState<TaskModalTab>(() => {
    if (task) {
      return getSmartDefaultTab(task)
    }
    return TASK_MODAL_TABS.ACTIVITY
  })

  // Update tab when task changes
  useEffect(() => {
    if (isOpen && task && !prevIsOpenRef.current) {
      setActiveTab(getSmartDefaultTab(task))
    }
  }, [isOpen, task])

  // Persist tab selection
  const handleTabChange = useCallback((value: string) => {
    const tab = value as TaskModalTab
    setActiveTab(tab)
    if (typeof window !== 'undefined') {
      localStorage.setItem(TASK_MODAL_TAB_KEY, tab)
    }
  }, [])

  // Invalidate activity cache when modal opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current && task?._id) {
      queryClient.invalidateQueries({ queryKey: ['activity-logs', 'task', task._id] })
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, task?._id, queryClient])

  // Auto-focus title input when creating
  useEffect(() => {
    if (isOpen && !task) {
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

  // Get group context for default values in create mode
  const { currentGroup, currentProject, groups, projects } = useGroupContext()

  // Core default values
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
    parentId: null,
    groupId: currentGroup?._id || null,
    projectId: currentProject?._id || null,
  }

  const defaultValues = useMemo(() => {
    const values: Record<string, unknown> = { ...coreDefaultValues }
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

  const selectedWorkflow = useMemo(
    () => workflows.find(w => w._id === selectedWorkflowId),
    [workflows, selectedWorkflowId]
  )

  const workflowStages = useMemo(
    () => selectedWorkflow?.steps?.map(s => s.name) || selectedWorkflow?.stages || [],
    [selectedWorkflow]
  )

  // Reset form when task changes
  useEffect(() => {
    if (task) {
      const values: Record<string, unknown> = {}
      Object.keys(coreDefaultValues).forEach((field) => {
        const value = (task as unknown as Record<string, unknown>)[field]
        if (field === 'tags') {
          values[field] = Array.isArray(value) ? value : []
        } else if (field === 'dueAt' && value) {
          values[field] = new Date(value as string).toISOString().slice(0, 16)
        } else {
          values[field] = value ?? coreDefaultValues[field]
        }
      })
      editableFields.forEach((fc) => {
        const value = (task as unknown as Record<string, unknown>)[fc.fieldPath]
        if (fc.fieldType === 'tags') {
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
      lastSavedDataRef.current = JSON.stringify(values)
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

  // Build task data from form values
  const buildTaskData = useCallback((data: Record<string, unknown>): Partial<Task> => {
    const taskData: Partial<Task> = {}
    const coreFields = Object.keys(coreDefaultValues)
    coreFields.forEach((field) => {
      const value = data[field]
      if (field === 'tags') {
        taskData[field as keyof Task] = (Array.isArray(value) ? value : []) as never
      } else if (field === 'dueAt') {
        taskData[field as keyof Task] = (value ? new Date(value as string).toISOString() : null) as never
      } else if (field === 'workflowId' || field === 'assigneeId' || field === 'parentId' || field === 'groupId' || field === 'projectId') {
        taskData[field as keyof Task] = (value || null) as never
      } else {
        taskData[field as keyof Task] = value as never
      }
    })
    editableFields.forEach((fc) => {
      if (coreFields.includes(fc.fieldPath)) return
      const value = data[fc.fieldPath]
      if (fc.fieldType === 'tags') {
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

  // Auto-save function
  const performAutoSave = useCallback(async () => {
    if (!task) return
    const data = getValues()
    const currentDataStr = JSON.stringify(data)
    if (currentDataStr === lastSavedDataRef.current) return
    try {
      const taskData = buildTaskData(data)
      await updateTask.mutateAsync({ id: task._id, data: taskData })
      lastSavedDataRef.current = currentDataStr
    } catch {
      // Silently fail
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

  // Watch for changes
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
    if (!isOpen) {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
        performAutoSave()
      }
      if (webhookSaveTimeoutRef.current) {
        clearTimeout(webhookSaveTimeoutRef.current)
      }
      setNewSubtaskTitle('')
      setIsCreatingSubtask(false)
    }
  }, [isOpen, performAutoSave])

  // Form submission
  const onSubmit = async (data: Record<string, unknown>) => {
    const title = data.title as string
    if (!task && (!title || !title.trim())) {
      return
    }

    const taskData = buildTaskData(data)

    if (!task && parentTask) {
      taskData.parentId = parentTask._id
    }

    if (taskData.taskType === 'external' && webhookConfig) {
      taskData.webhookConfig = webhookConfig
    }

    // For flow tasks, set the workflow to trigger and input payload
    if (taskData.taskType === 'flow' && flowConfig?.workflowId) {
      taskData.triggerWorkflowId = flowConfig.workflowId
      // Parse input payload and add to metadata for the workflow to receive
      if (flowConfig.inputPayload) {
        try {
          // Store the template string in metadata - backend will resolve variables
          taskData.metadata = {
            ...(taskData.metadata || {}),
            flowInputPayloadTemplate: flowConfig.inputPayload,
          }
        } catch {
          // If parsing fails, just store as template
          taskData.metadata = {
            ...(taskData.metadata || {}),
            flowInputPayloadTemplate: flowConfig.inputPayload,
          }
        }
      }
    }

    if (task) {
      await updateTask.mutateAsync({ id: task._id, data: taskData })
    } else {
      await createTask.mutateAsync(taskData)
    }

    onClose()
  }

  // Current selected values
  const currentStatus = watch('status') as string
  const currentUrgency = watch('urgency') as string
  const currentAssigneeId = watch('assigneeId') as string | null

  const currentStatusOption = statusOptions.find(s => s.code === currentStatus)
  const currentUrgencyOption = urgencyOptions.find(u => u.code === currentUrgency)
  const currentAssignee = users.find(u => u._id === currentAssigneeId)

  // Handle title blur
  const handleTitleBlur = useCallback(() => {
    if (!task) return
    const title = getValues('title')
    if (title && title !== task.title) {
      performAutoSave()
    }
  }, [task, getValues, performAutoSave])

  // Subtask handlers
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
      setTimeout(() => {
        subtaskInputRef.current?.focus()
      }, 0)
    }
  }, [newSubtaskTitle, task, createTask])

  const handleSubtaskInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreateSubtask()
    }
  }, [handleCreateSubtask])

  const handleSubtaskClick = useCallback((subtaskId: string) => {
    router.push(`/tasks?taskId=${subtaskId}`, { scroll: false })
  }, [router])

  // Document handler
  const handleDetachDocument = useCallback((documentId: string) => {
    if (!task) return
    detachDocument.mutate(
      { taskId: task._id, documentId },
      {
        onSuccess: () => {
          toast.success('Document detached')
        },
        onError: (error) => {
          toast.error('Failed to detach document: ' + error.message)
        },
      }
    )
  }, [task, detachDocument])

  // Rerun handler
  const handleRerun = useCallback(async () => {
    if (!task) return
    try {
      await rerunTask.mutateAsync({ id: task._id })
      toast.success('Task rerun started')
    } catch (error) {
      toast.error('Failed to rerun task')
    }
  }, [task, rerunTask])

  // Webhook execution handlers
  const handleExecuteWebhook = useCallback(async () => {
    if (!task?._id || !webhookConfig) return
    setIsExecutingWebhook(true)
    try {
      const { tasksApi } = await import('@/lib/api')
      await tasksApi.executeWebhook(task._id)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
      toast.success('Webhook executed')
    } catch (error) {
      toast.error('Failed to execute webhook')
    } finally {
      setIsExecutingWebhook(false)
    }
  }, [task, webhookConfig, queryClient])

  const handleRetryWebhook = useCallback(async () => {
    if (!task?._id || !webhookConfig) return
    setIsRetryingWebhook(true)
    try {
      const { tasksApi } = await import('@/lib/api')
      await tasksApi.retryWebhook(task._id)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
      toast.success('Webhook retried')
    } catch (error) {
      toast.error('Failed to retry webhook')
    } finally {
      setIsRetryingWebhook(false)
    }
  }, [task, webhookConfig, queryClient])

  // Webhook config change handler
  const handleWebhookConfigChange = useCallback((config: WebhookConfig, options?: { skipSave?: boolean }) => {
    setWebhookConfig(config)
    if (!options?.skipSave && task) {
      if (webhookSaveTimeoutRef.current) {
        clearTimeout(webhookSaveTimeoutRef.current)
      }
      webhookSaveTimeoutRef.current = setTimeout(() => {
        updateTask.mutate({ id: task._id, data: { webhookConfig: config } })
      }, 800)
    }
  }, [task, updateTask])

  // Rollback handler for manual review tasks
  const handleRollback = useCallback(async () => {
    if (!task?._id) return
    try {
      const { tasksApi } = await import('@/lib/api')
      // Get the review comment from the OutputTab state (passed through the component)
      const response = await tasksApi.rollback(task._id)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task._id] })
      if (response.data?.newTaskId) {
        queryClient.invalidateQueries({ queryKey: ['task', response.data.newTaskId] })
      }
      toast.success('Task rolled back to previous step')
      onClose()
    } catch (error) {
      toast.error('Failed to rollback task')
      throw error
    }
  }, [task, queryClient, onClose])

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
          <form onSubmit={handleSubmit(onSubmit)} className="flex-1 min-h-0 overflow-y-auto pr-4 -mr-4">
            <div className="space-y-3 pb-4">
              {/* Title */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Title *</label>
                <Input
                  {...register('title', { required: true })}
                  ref={(e) => {
                    register('title').ref(e)
                    titleInputRef.current = e
                  }}
                  placeholder="Task title..."
                  className="h-9"
                />
              </div>

              {/* Summary */}
              <Controller
                name="summary"
                control={control}
                render={({ field }) => (
                  <TemplateTextarea
                    label="Summary"
                    value={field.value as string || ''}
                    onChange={field.onChange}
                    placeholder="Brief description... Use {{variable}} for dynamic values"
                    minHeight="60px"
                    maxHeight="120px"
                    showTokenBrowser={true}
                    taskOnly={true}
                  />
                )}
              />

              {/* Task Type */}
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
                        if (val === 'external' && !webhookConfig) {
                          setWebhookConfig({
                            url: '',
                            method: 'POST',
                            maxRetries: 3,
                            retryDelayMs: 1000,
                            timeoutMs: 30000,
                          })
                        }
                        if (val === 'flow' && !flowConfig) {
                          setFlowConfig({
                            workflowId: '',
                            inputPayload: '{\n  "title": "{{title}}",\n  "summary": "{{summary}}"\n}',
                          })
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select type" />
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
                  )}
                />
              </div>

              {/* Webhook Configuration for external type */}
              {currentTaskType === 'external' && (
                <WebhookTaskConfig
                  task={null}
                  isEditMode={false}
                  webhookConfig={webhookConfig}
                  onConfigChange={(config) => setWebhookConfig(config)}
                />
              )}

              {/* Flow Configuration for flow type */}
              {currentTaskType === 'flow' && (
                <FlowTaskConfig
                  task={null}
                  isEditMode={false}
                  flowConfig={flowConfig}
                  onConfigChange={(config) => setFlowConfig(config)}
                />
              )}

              {/* Assignee */}
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
                          .filter((user) => user._id && user.isActive && !isSystemUser(user))
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

              {/* Group */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Group</label>
                <Controller
                  name="groupId"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={(field.value as string) || '_none'}
                      onValueChange={(val) => {
                        const newGroupId = val === '_none' ? null : val
                        field.onChange(newGroupId)
                        // Clear project when group changes
                        setValue('projectId', null)
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select group" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            <span>No group (admin only)</span>
                          </div>
                        </SelectItem>
                        {groups.map((group) => (
                          <SelectItem key={group._id} value={group._id}>
                            <div className="flex items-center gap-2">
                              <Users className="h-3.5 w-3.5" />
                              <span>{group.displayName}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              {/* Project - only show if a group is selected */}
              {(() => {
                const selectedGroupId = watch('groupId') as string | null
                if (!selectedGroupId) return null
                const groupProjects = projects.filter(p => p.groupId === selectedGroupId)
                return (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Project</label>
                    <Controller
                      name="projectId"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={(field.value as string) || '_none'}
                          onValueChange={(val) => field.onChange(val === '_none' ? null : val)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select project (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <FolderKanban className="h-3.5 w-3.5" />
                                <span>No project</span>
                              </div>
                            </SelectItem>
                            {groupProjects.map((project) => (
                              <SelectItem key={project._id} value={project._id}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: project.color || '#888' }}
                                  />
                                  <span>{project.displayName}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                )
              })()}

              {/* Parent Task info */}
              {parentTask && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Parent Task</label>
                  <div className="px-3 py-1.5 text-sm bg-muted rounded-md border">
                    {parentTask.title}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-3 mt-3 border-t flex-shrink-0">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }

  // Edit mode - new single-column layout
  const typeConfig = getTaskTypeConfig(currentTaskType)
  const TypeIcon = typeConfig.icon

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        {/* Accessibility: visually hidden title */}
        <span className="sr-only">Edit Task</span>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex-shrink-0 border-b border-border">
          {/* Editable title */}
          <input
            {...register('title', {
              onBlur: handleTitleBlur,
            })}
            placeholder="Task title..."
            className={cn(
              'w-full text-lg font-semibold bg-transparent',
              'border-0 border-b-2 border-transparent rounded-none',
              'hover:border-muted-foreground/30 focus:border-primary',
              'focus:outline-none focus:ring-0',
              'transition-colors duration-150',
              'placeholder:text-muted-foreground/50'
            )}
          />

          {/* Inline controls */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {/* Task Type */}
            <Controller
              name="taskType"
              control={control}
              render={({ field }) => {
                const config = getTaskTypeConfig(field.value as string)
                const Icon = config.icon
                return (
                  <Select
                    value={field.value as string || 'agent'}
                    onValueChange={(val) => {
                      field.onChange(val)
                      if (val === 'external' && !webhookConfig) {
                        setWebhookConfig({
                          url: '',
                          method: 'POST',
                          maxRetries: 3,
                          retryDelayMs: 1000,
                          timeoutMs: 30000,
                        })
                      }
                      updateTask.mutate({ id: task._id, data: { taskType: val as TaskType } })
                    }}
                  >
                    <SelectTrigger
                      className="h-7 w-auto gap-1.5 px-2 text-xs border-0 hover:bg-muted"
                      style={{
                        backgroundColor: `${config.hexColor}15`,
                        color: config.hexColor,
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{config.label}</span>
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

            {/* Status */}
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || ''}
                  onValueChange={(value) => {
                    field.onChange(value)
                    updateTask.mutate({ id: task._id, data: { status: value } })
                  }}
                >
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

            {/* Urgency */}
            <Controller
              name="urgency"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || ''}
                  onValueChange={(value) => {
                    field.onChange(value)
                    updateTask.mutate({ id: task._id, data: { urgency: value } })
                  }}
                >
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

            {/* Assignee */}
            <Controller
              name="assigneeId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || '_unassigned'}
                  onValueChange={(val) => {
                    const newValue = val === '_unassigned' ? null : val
                    field.onChange(newValue)
                    updateTask.mutate({ id: task._id, data: { assigneeId: newValue } })
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
                      .filter((user) => user._id && user.isActive && !isSystemUser(user))
                      .map((user) => (
                        <SelectItem key={user._id} value={user._id}>
                          <UserChip user={user} size="sm" />
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />

            {/* Workflow Run Link */}
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

            {/* Parent Task Link */}
            {task._resolved?.parent && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  router.push(`/tasks?taskId=${task._resolved!.parent!._id}`)
                }}
                className="flex items-center gap-1.5 px-2 h-7 text-xs rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors max-w-[200px]"
              >
                <span className="truncate">{task._resolved.parent.title}</span>
                <ExternalLink className="h-3 w-3 opacity-60 flex-shrink-0" />
              </button>
            )}

            {/* Timestamps */}
            <div className="ml-auto text-[10px] text-muted-foreground">
              Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
              {task.updatedAt !== task.createdAt && (
                <span className="ml-2">
                  Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Main content - single scrollable area */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 min-h-0 flex flex-col">
          {/* Tab List (fixed) */}
          <div className="flex-shrink-0">
            <TabsList className="w-full justify-start px-5 pt-2 pb-0 rounded-none border-b border-border bg-transparent h-auto">
              <TabsTrigger
                value={TASK_MODAL_TABS.OUTPUT}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <FileOutput className="h-3.5 w-3.5" />
                <span className="text-xs">Output</span>
              </TabsTrigger>
              <TabsTrigger
                value={TASK_MODAL_TABS.SUBTASKS}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <ListTree className="h-3.5 w-3.5" />
                <span className="text-xs">Subtasks</span>
                {subtasks.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-muted px-1 rounded">{subtasks.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value={TASK_MODAL_TABS.DOCUMENTS}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="text-xs">Documents</span>
                {attachedDocuments.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-muted px-1 rounded">{attachedDocuments.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value={TASK_MODAL_TABS.ACTIVITY}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <Activity className="h-3.5 w-3.5" />
                <span className="text-xs">Activity</span>
              </TabsTrigger>
              <TabsTrigger
                value={TASK_MODAL_TABS.METADATA}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <Braces className="h-3.5 w-3.5" />
                <span className="text-xs">Metadata</span>
              </TabsTrigger>
              {task.stepConfig && (
                <TabsTrigger
                  value={TASK_MODAL_TABS.STEP_CONFIG}
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="text-xs">Step Config</span>
                </TabsTrigger>
              )}
              <TabsTrigger
                value={TASK_MODAL_TABS.DETAILS}
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <Settings className="h-3.5 w-3.5" />
                <span className="text-xs">Details</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab Content - scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-4 -mr-4">
            <TabsContent value={TASK_MODAL_TABS.OUTPUT} className="mt-0">
              <OutputTab task={task} onRollback={task.workflowRunId ? handleRollback : undefined} />
            </TabsContent>

            <TabsContent value={TASK_MODAL_TABS.SUBTASKS} className="mt-0">
              <SubtasksList
                subtasks={subtasks}
                isLoading={isLoadingChildren}
                statusOptions={statusOptions}
                users={users}
                onSubtaskClick={handleSubtaskClick}
                newSubtaskTitle={newSubtaskTitle}
                setNewSubtaskTitle={setNewSubtaskTitle}
                onSubtaskInputKeyDown={handleSubtaskInputKeyDown}
                isCreatingSubtask={isCreatingSubtask}
                subtaskInputRef={subtaskInputRef}
              />
            </TabsContent>

            <TabsContent value={TASK_MODAL_TABS.DOCUMENTS} className="mt-0">
              <AttachedDocuments
                taskId={task._id}
                documents={attachedDocuments}
                isLoading={isLoadingDocuments}
                onDetach={handleDetachDocument}
                isDetaching={detachDocument.isPending}
              />
            </TabsContent>

            <TabsContent value={TASK_MODAL_TABS.ACTIVITY} className="mt-0">
              <TaskActivity taskId={task._id} className="p-4" compact />
            </TabsContent>

            <TabsContent value={TASK_MODAL_TABS.METADATA} className="mt-0">
              <MetadataTab task={task} onSave={handleMetadataSave} />
            </TabsContent>

            {task.stepConfig && (
              <TabsContent value={TASK_MODAL_TABS.STEP_CONFIG} className="mt-0">
                <StepConfigTab
                  task={task}
                  onConfigChange={(newConfig) => {
                    updateTask.mutate({
                      id: task._id,
                      data: { stepConfig: newConfig }
                    })
                  }}
                />
              </TabsContent>
            )}

            <TabsContent value={TASK_MODAL_TABS.DETAILS} className="mt-0">
              <DetailsTab
                task={task}
                control={control}
                register={register}
                setValue={setValue}
                watch={watch}
                workflows={workflows}
                users={users}
                allTasks={allTasks}
                webhookConfig={webhookConfig}
                onWebhookConfigChange={handleWebhookConfigChange}
                updateTask={updateTask}
                statusOptions={statusOptions}
                onRerun={handleRerun}
                onExecuteWebhook={handleExecuteWebhook}
                onRetryWebhook={handleRetryWebhook}
                isRerunning={rerunTask.isPending}
                isExecuting={isExecutingWebhook}
                isRetrying={isRetryingWebhook}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
