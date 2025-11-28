'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
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

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  status: z.string().default('pending'),
  priority: z.string().default('medium'),
  hitlRequired: z.boolean().default(false),
  hitlPhase: z.string().default('none'),
  assigneeId: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  tags: z.string().optional(),
})

type TaskFormData = z.infer<typeof taskSchema>

interface TaskModalProps {
  task: Task | null
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  onClose: () => void
}

export function TaskModal({
  task,
  isOpen,
  fieldConfigs,
  lookups,
  onClose,
}: TaskModalProps) {
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const { data: usersData } = useUsers()
  const users = usersData?.data || []

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      status: 'pending',
      priority: 'medium',
      hitlRequired: false,
      hitlPhase: 'none',
      assigneeId: null,
      dueAt: null,
      tags: '',
    },
  })

  useEffect(() => {
    if (task) {
      reset({
        title: task.title,
        description: task.description || '',
        status: task.status,
        priority: task.priority || 'medium',
        hitlRequired: task.hitlRequired,
        hitlPhase: task.hitlPhase || 'none',
        assigneeId: task.assigneeId || null,
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : null,
        tags: task.tags?.join(', ') || '',
      })
    } else {
      reset({
        title: '',
        description: '',
        status: 'pending',
        priority: 'medium',
        hitlRequired: false,
        hitlPhase: 'none',
        assigneeId: null,
        dueAt: null,
        tags: '',
      })
    }
  }, [task, reset])

  const onSubmit = async (data: TaskFormData) => {
    const taskData = {
      ...data,
      tags: data.tags
        ? data.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      dueAt: data.dueAt ? new Date(data.dueAt).toISOString() : null,
      assigneeId: data.assigneeId || null,
    }

    if (task) {
      await updateTask.mutateAsync({ id: task._id, data: taskData })
    } else {
      await createTask.mutateAsync(taskData)
    }

    onClose()
  }

  const statusOptions = lookups.task_status || []
  const priorityOptions = lookups.priority || []
  const hitlPhaseOptions = lookups.hitl_phase || []

  const hitlRequired = watch('hitlRequired')

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Create New Task'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Title *</label>
            <Input {...register('title')} placeholder="Enter task title" />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              {...register('description')}
              placeholder="Enter task description"
              className={cn(
                'flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'ring-offset-background placeholder:text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            />
          </div>

          {/* Status and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                value={watch('status')}
                onValueChange={(val) => setValue('status', val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.code} value={opt.code}>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: opt.color }}
                        />
                        {opt.displayName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <Select
                value={watch('priority')}
                onValueChange={(val) => setValue('priority', val)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((opt) => (
                    <SelectItem key={opt.code} value={opt.code}>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: opt.color }}
                        />
                        {opt.displayName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Assignee and Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Assignee</label>
              <Select
                value={watch('assigneeId') || ''}
                onValueChange={(val) => setValue('assigneeId', val || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Due Date</label>
              <Input
                type="datetime-local"
                {...register('dueAt')}
              />
            </div>
          </div>

          {/* HITL Settings */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hitlRequired"
                checked={hitlRequired}
                onCheckedChange={(checked) => setValue('hitlRequired', !!checked)}
              />
              <label htmlFor="hitlRequired" className="text-sm font-medium">
                Human-in-the-Loop Required
              </label>
            </div>

            {hitlRequired && (
              <div className="space-y-2">
                <label className="text-sm font-medium">HITL Phase</label>
                <Select
                  value={watch('hitlPhase')}
                  onValueChange={(val) => setValue('hitlPhase', val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hitlPhaseOptions.map((opt) => (
                      <SelectItem key={opt.code} value={opt.code}>
                        {opt.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <Input
              {...register('tags')}
              placeholder="Enter tags separated by commas"
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple tags with commas
            </p>
          </div>

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
