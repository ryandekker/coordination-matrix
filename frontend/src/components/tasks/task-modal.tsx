'use client'

import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Task, FieldConfig, LookupValue } from '@/lib/api'
import { useCreateTask, useUpdateTask, useUsers } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'

interface TaskModalProps {
  task: Task | null
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  parentTask?: Task | null
  onClose: () => void
}

type FormValues = Record<string, unknown>

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
  const users = usersData?.data || []

  // Get editable fields sorted by display order
  const editableFields = useMemo(() => {
    return fieldConfigs
      .filter((fc) => fc.isEditable)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [fieldConfigs])

  // Build default values from editable fields
  const defaultValues = useMemo(() => {
    const values: FormValues = {}
    editableFields.forEach((fc) => {
      if (fc.fieldType === 'boolean') {
        values[fc.fieldPath] = false
      } else if (fc.fieldType === 'tags') {
        values[fc.fieldPath] = ''
      } else if (fc.fieldType === 'select') {
        // Use first lookup value as default if available
        const opts = lookups[fc.lookupType || ''] || []
        values[fc.fieldPath] = opts[0]?.code || ''
      } else {
        values[fc.fieldPath] = ''
      }
    })
    return values
  }, [editableFields, lookups])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues,
  })

  // Reset form when task changes
  useEffect(() => {
    if (task) {
      const values: FormValues = {}
      editableFields.forEach((fc) => {
        const rawValue = (task as unknown as Record<string, unknown>)[fc.fieldPath]
        if (fc.fieldType === 'tags' && Array.isArray(rawValue)) {
          values[fc.fieldPath] = rawValue.join(', ')
        } else if (fc.fieldType === 'datetime' && rawValue) {
          values[fc.fieldPath] = new Date(rawValue as string).toISOString().slice(0, 16)
        } else if (fc.fieldType === 'reference') {
          // Handle reference fields - could be ObjectId or string
          values[fc.fieldPath] = rawValue?.toString() || ''
        } else {
          values[fc.fieldPath] = rawValue ?? ''
        }
      })
      reset(values)
    } else {
      const values = { ...defaultValues }
      // Set parent ID if creating subtask
      if (parentTask) {
        values.parentId = parentTask._id.toString()
      }
      reset(values)
    }
  }, [task, parentTask, reset, editableFields, defaultValues])

  const onSubmit = async (data: FormValues) => {
    const taskData: Partial<Task> = {}

    editableFields.forEach((fc) => {
      const value = data[fc.fieldPath]

      if (fc.fieldType === 'tags' && typeof value === 'string') {
        (taskData as Record<string, unknown>)[fc.fieldPath] = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      } else if (fc.fieldType === 'datetime' && value) {
        (taskData as Record<string, unknown>)[fc.fieldPath] = new Date(value as string).toISOString()
      } else if (fc.fieldType === 'datetime' && !value) {
        (taskData as Record<string, unknown>)[fc.fieldPath] = null
      } else if (fc.fieldType === 'reference') {
        // Handle empty references
        (taskData as Record<string, unknown>)[fc.fieldPath] = value || null
      } else if (fc.fieldType === 'number' && value !== '') {
        (taskData as Record<string, unknown>)[fc.fieldPath] = Number(value)
      } else if (fc.fieldType === 'boolean') {
        (taskData as Record<string, unknown>)[fc.fieldPath] = Boolean(value)
      } else {
        (taskData as Record<string, unknown>)[fc.fieldPath] = value
      }
    })

    // Set parent ID if creating subtask (and not already in editable fields)
    if (!task && parentTask && !taskData.parentId) {
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
    const value = watch(fc.fieldPath)
    const isRequired = fc.isRequired

    switch (fc.fieldType) {
      case 'text':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
            />
            {errors[fc.fieldPath] && (
              <p className="text-sm text-destructive">{fc.displayName} is required</p>
            )}
          </div>
        )

      case 'textarea':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <textarea
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
              className={cn(
                'flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            />
          </div>
        )

      case 'number':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              type="number"
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
            />
          </div>
        )

      case 'boolean':
        return (
          <div key={fc.fieldPath} className="flex items-center space-x-2 py-2">
            <Checkbox
              id={fc.fieldPath}
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValue(fc.fieldPath, checked)}
            />
            <label htmlFor={fc.fieldPath} className="text-sm font-medium cursor-pointer">
              {fc.displayName}
            </label>
          </div>
        )

      case 'select': {
        const options = lookups[fc.lookupType || ''] || []
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Select
              value={value as string || ''}
              onValueChange={(val) => setValue(fc.fieldPath, val)}
            >
              <SelectTrigger>
                <SelectValue placeholder={`Select ${fc.displayName.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.code} value={opt.code}>
                    <div className="flex items-center gap-2">
                      {opt.color && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: opt.color }}
                        />
                      )}
                      {opt.displayName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      }

      case 'reference': {
        // Handle reference fields - for now, just users
        if (fc.referenceCollection === 'users') {
          return (
            <div key={fc.fieldPath} className="space-y-2">
              <label className="text-sm font-medium">
                {fc.displayName} {isRequired && '*'}
              </label>
              <Select
                value={value as string || '_unassigned'}
                onValueChange={(val) => setValue(fc.fieldPath, val === '_unassigned' ? '' : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${fc.displayName.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unassigned">Unassigned</SelectItem>
                  {users
                    .filter((user) => user._id && user.isActive)
                    .map((user) => (
                      <SelectItem key={user._id} value={user._id}>
                        {user.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )
        }
        // For other reference types, show as text input (ID)
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder={`Enter ${fc.displayName.toLowerCase()} ID`}
            />
          </div>
        )
      }

      case 'datetime':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              type="datetime-local"
              {...register(fc.fieldPath, { required: isRequired })}
            />
          </div>
        )

      case 'date':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              type="date"
              {...register(fc.fieldPath, { required: isRequired })}
            />
          </div>
        )

      case 'tags':
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder="Enter values separated by commas"
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple values with commas
            </p>
          </div>
        )

      default:
        return (
          <div key={fc.fieldPath} className="space-y-2">
            <label className="text-sm font-medium">
              {fc.displayName} {isRequired && '*'}
            </label>
            <Input
              {...register(fc.fieldPath, { required: isRequired })}
              placeholder={`Enter ${fc.displayName.toLowerCase()}`}
            />
          </div>
        )
    }
  }

  // Group fields for layout - put small fields in pairs
  const groupedFields = useMemo(() => {
    const groups: FieldConfig[][] = []
    const smallTypes = ['select', 'reference', 'datetime', 'date', 'number', 'boolean']

    let currentPair: FieldConfig[] = []

    editableFields.forEach((fc) => {
      // Skip parentId when not creating subtask
      if (fc.fieldPath === 'parentId' && !parentTask && !task) {
        return
      }

      if (smallTypes.includes(fc.fieldType)) {
        currentPair.push(fc)
        if (currentPair.length === 2) {
          groups.push([...currentPair])
          currentPair = []
        }
      } else {
        // Flush any pending pair
        if (currentPair.length > 0) {
          groups.push([...currentPair])
          currentPair = []
        }
        groups.push([fc])
      }
    })

    // Flush remaining
    if (currentPair.length > 0) {
      groups.push(currentPair)
    }

    return groups
  }, [editableFields, parentTask, task])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {task ? 'Edit Task' : parentTask ? `Create Subtask under "${parentTask.title}"` : 'Create New Task'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 px-1">
          {groupedFields.map((group, idx) => (
            group.length === 2 ? (
              <div key={idx} className="grid grid-cols-2 gap-4">
                {group.map((fc) => renderField(fc))}
              </div>
            ) : (
              <div key={idx}>
                {group.map((fc) => renderField(fc))}
              </div>
            )
          ))}

          {editableFields.length === 0 && (
            <p className="text-muted-foreground text-center py-8">
              No editable fields configured. Go to Field Config to enable editing.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || editableFields.length === 0}>
              {isSubmitting ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
