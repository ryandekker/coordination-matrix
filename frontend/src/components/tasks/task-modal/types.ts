// Shared types for task modal components
import type { Task, FieldConfig, LookupValue, WebhookConfig } from '@/lib/api'
import type { UseFormRegister, UseFormWatch, UseFormSetValue, UseFormGetValues, Control } from 'react-hook-form'

export interface TaskModalProps {
  task: Task | null
  isOpen: boolean
  fieldConfigs: FieldConfig[]
  lookups: Record<string, LookupValue[]>
  parentTask?: Task | null
  onClose: () => void
}

export interface TaskFormValues {
  title: string
  summary: string
  extraPrompt: string
  status: string
  urgency: string
  workflowId: string | null
  workflowStage: string
  assigneeId: string | null
  dueAt: string | null
  tags: string[]
  taskType: string
  parentId?: string
  [key: string]: unknown
}

export interface FormContextProps {
  register: UseFormRegister<TaskFormValues>
  watch: UseFormWatch<TaskFormValues>
  setValue: UseFormSetValue<TaskFormValues>
  getValues: UseFormGetValues<TaskFormValues>
  control: Control<TaskFormValues>
}

export interface TaskUser {
  _id: string
  displayName: string
  isActive?: boolean
}

export interface TaskWorkflow {
  _id: string
  name: string
  steps?: Array<{ name: string }>
  stages?: string[]
}

export interface SubtaskListProps {
  subtasks: Task[]
  isLoading: boolean
  statusOptions: LookupValue[]
  users: TaskUser[]
  onSubtaskClick: (id: string) => void
  newSubtaskTitle: string
  setNewSubtaskTitle: (title: string) => void
  onSubtaskInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  isCreatingSubtask: boolean
  subtaskInputRef: React.RefObject<HTMLInputElement>
}

export interface MetadataContentProps {
  task: Task | null
  isEditMode: boolean
  setIsEditMode: (value: boolean) => void
  metadataError: string | null
  setMetadataError: (error: string | null) => void
  metadataTextareaRef: React.RefObject<HTMLTextAreaElement>
  savedMetadataValueRef: React.MutableRefObject<string>
  currentMetadataValueRef: React.MutableRefObject<string>
  onSave: (parsed: Record<string, unknown>) => Promise<void>
}

export interface TypeConfigContentProps {
  task: Task | null
  currentTaskType: string
  register: UseFormRegister<TaskFormValues>
  webhookConfig: WebhookConfig | undefined
  onWebhookConfigChange: (config: WebhookConfig | undefined, options?: { skipSave?: boolean }) => void
  canRerun: boolean
  onRerun: () => void
  rerunPending: boolean
  updateTask: (data: Partial<Task>) => Promise<void>
}

export interface EditableHeaderProps {
  task: Task
  statusOptions: LookupValue[]
  urgencyOptions: LookupValue[]
  users: TaskUser[]
  control: Control<TaskFormValues>
  onStatusChange: (value: string) => void
  onUrgencyChange: (value: string) => void
  onAssigneeChange: (value: string | null) => void
  onClose: () => void
}
