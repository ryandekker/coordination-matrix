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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Task, FieldConfig, LookupValue } from '@/lib/api'
import { useCreateTask, useUpdateTask, useUsers } from '@/hooks/use-tasks'
import { cn } from '@/lib/utils'
import { TaskActivity } from './task-activity'

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  summary: z.string().optional(),
  status: z.string().default('pending'),
  urgency: z.string().default('normal'),
  assigneeId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  tags: z.string().optional(),
})

type TaskFormData = z.infer<typeof taskSchema>

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
      summary: '',
      status: 'pending',
      urgency: 'normal',
      assigneeId: null,
      parentId: null,
      dueAt: null,
      tags: '',
    },
  })

  useEffect(() => {
    if (task) {
      reset({
        title: task.title,
        summary: task.summary || '',
        status: task.status,
        urgency: task.urgency || 'normal',
        assigneeId: task.assigneeId || null,
        parentId: task.parentId?.toString() || null,
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : null,
        tags: task.tags?.join(', ') || '',
      })
    } else {
      reset({
        title: '',
        summary: '',
        status: 'pending',
        urgency: 'normal',
        assigneeId: null,
        parentId: parentTask?._id.toString() || null,
        dueAt: null,
        tags: '',
      })
    }
  }, [task, parentTask, reset])

  const onSubmit = async (data: TaskFormData) => {
    const taskData: Partial<Task> = {
      title: data.title,
      summary: data.summary || '',
      status: data.status,
      urgency: data.urgency,
      tags: data.tags
        ? data.tags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      dueAt: data.dueAt ? new Date(data.dueAt).toISOString() : null,
      assigneeId: data.assigneeId || null,
    }

    // Only include parentId if we're creating a subtask
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

  const statusOptions = lookups.task_status || []
  const urgencyOptions = lookups.urgency || []

  const formContent = (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Title *</label>
        <Input {...register('title')} placeholder="Enter task title" />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Summary */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Summary</label>
        <textarea
          {...register('summary')}
          placeholder="Enter task summary"
          className={cn(
            'flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
            'ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
        />
      </div>

      {/* Status and Urgency */}
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
          <label className="text-sm font-medium">Urgency</label>
          <Select
            value={watch('urgency')}
            onValueChange={(val) => setValue('urgency', val)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {urgencyOptions.map((opt) => (
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

      {/* Parent Task (for creating subtasks) */}
      {!task && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Parent Task (Optional)</label>
          <Input
            value={parentTask?.title || ''}
            disabled
            placeholder="This will be a root task"
            className="bg-muted"
          />
          {parentTask && (
            <p className="text-xs text-muted-foreground">
              Creating subtask under: {parentTask.title}
            </p>
          )}
        </div>
      )}

      {/* Assignee and Due Date */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Assignee</label>
          <Select
            value={watch('assigneeId') || '_unassigned'}
            onValueChange={(val) => setValue('assigneeId', val === '_unassigned' ? null : val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_unassigned">Unassigned</SelectItem>
              {users
                .filter((user) => user._id)
                .map((user) => (
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
  )

  // For new tasks, show just the form
  if (!task) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {parentTask ? `Create Subtask under "${parentTask.title}"` : 'Create New Task'}
            </DialogTitle>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    )
  }

  // For existing tasks, show tabs with form and activity
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="flex-1 overflow-y-auto mt-4 px-1">
            {formContent}
          </TabsContent>

          <TabsContent value="activity" className="flex-1 overflow-hidden mt-4">
            <TaskActivity taskId={task._id} className="h-full" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
