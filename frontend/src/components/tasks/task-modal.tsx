'use client'

import { useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
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
import { Task, FieldConfig, LookupValue, User, Workflow } from '@/lib/api'
import { useCreateTask, useUpdateTask, useUsers, useWorkflows, useTasks } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'

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
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const { data: usersData } = useUsers()
  const { data: workflowsData } = useWorkflows()
  const { data: tasksData } = useTasks({ limit: 100 })

  const users = usersData?.data || []
  const workflows = workflowsData?.data || []
  const allTasks = tasksData?.data || []

  // Get editable fields sorted by displayOrder
  const editableFields = useMemo(() => {
    return fieldConfigs
      .filter((fc) => fc.isEditable)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [fieldConfigs])

  // Build default values from field configs
  const defaultValues = useMemo(() => {
    const values: Record<string, unknown> = {}
    editableFields.forEach((fc) => {
      if (fc.defaultValue !== undefined) {
        values[fc.fieldPath] = fc.defaultValue
      } else {
        // Set sensible defaults based on field type
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
    formState: { isSubmitting },
  } = useForm({
    defaultValues,
  })

  // Reset form when task changes
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
    } else {
      const values = { ...defaultValues }
      // Set parent if creating subtask
      if (parentTask) {
        values.parentId = parentTask._id
      }
      reset(values)
    }
  }, [task, parentTask, reset, editableFields, defaultValues])

  const onSubmit = async (data: Record<string, unknown>) => {
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
      } else if (fc.fieldType === 'reference') {
        taskData[fc.fieldPath as keyof Task] = (value || null) as never
      } else {
        taskData[fc.fieldPath as keyof Task] = value as never
      }
    })

    // For new tasks with a parent, ensure parentId is set
    if (!task && parentTask) {
      taskData.parentId = parentTask._id
    }

    if (task) {
      await updateTask.mutateAsync({ id: task._id, data: taskData })
    } else {
      await createTask.mutateAsync(taskData)
    }

    onClose()
  }

  // Render a field based on its config
  const renderField = (fc: FieldConfig) => {
    const fieldKey = fc.fieldPath

    switch (fc.fieldType) {
      case 'text':
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Input
              {...register(fieldKey)}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
            />
          </div>
        )

      case 'textarea':
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <textarea
              {...register(fieldKey)}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
              className={cn(
                'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            />
          </div>
        )

      case 'select':
        const options = fc.lookupType ? lookups[fc.lookupType] || [] : fc.options || []
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Controller
              name={fieldKey}
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || ''}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${fc.displayName.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((opt) => {
                      const code = 'code' in opt ? opt.code : opt.value
                      const label = 'displayName' in opt ? opt.displayName : opt.label
                      const color = 'color' in opt ? opt.color : undefined
                      return (
                        <SelectItem key={code} value={code}>
                          <div className="flex items-center gap-2">
                            {color && (
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                            )}
                            {label}
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        )

      case 'reference':
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Controller
              name={fieldKey}
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value as string || '_none'}
                  onValueChange={(val) => field.onChange(val === '_none' ? null : val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${fc.displayName.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">None</SelectItem>
                    {renderReferenceOptions(fc, users, workflows, allTasks, task)}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        )

      case 'datetime':
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Input
              type="datetime-local"
              {...register(fieldKey)}
            />
          </div>
        )

      case 'tags':
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Input
              {...register(fieldKey)}
              placeholder="Enter tags separated by commas"
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple tags with commas
            </p>
          </div>
        )

      default:
        return (
          <div key={fieldKey} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName}
              {fc.isRequired && ' *'}
            </label>
            <Input
              {...register(fieldKey)}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
            />
          </div>
        )
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Create New Task'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 px-1">
          {/* Parent Task Info (for creating subtasks) */}
          {!task && parentTask && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                Creating subtask under: <strong>{parentTask.title}</strong>
              </p>
            </div>
          )}

          {/* Render all editable fields dynamically */}
          {editableFields.map((fc) => renderField(fc))}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Helper to render reference options based on the collection
function renderReferenceOptions(
  fc: FieldConfig,
  users: User[],
  workflows: Workflow[],
  allTasks: Task[],
  currentTask: Task | null
) {
  switch (fc.referenceCollection) {
    case 'users':
      return users
        .filter((user) => user._id && user.isActive)
        .map((user) => (
          <SelectItem key={user._id} value={user._id}>
            {user.displayName}
          </SelectItem>
        ))

    case 'workflows':
      return workflows
        .filter((wf) => wf._id && wf.isActive)
        .map((wf) => (
          <SelectItem key={wf._id} value={wf._id}>
            {wf.name}
          </SelectItem>
        ))

    case 'tasks':
      // Filter out current task and its children to prevent circular references
      return allTasks
        .filter((t) => t._id !== currentTask?._id)
        .map((t) => (
          <SelectItem key={t._id} value={t._id}>
            {t.title}
          </SelectItem>
        ))

    default:
      return null
  }
}
