'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2, Edit2, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TaskStepConfig as TaskStepConfigType, TaskType, JoinBoundary, StepConnection, FindDocumentConfig } from '@/lib/api'

interface TaskStepConfigProps {
  stepConfig: TaskStepConfigType | undefined
  taskType?: TaskType
  onConfigChange?: (config: TaskStepConfigType) => void
  readOnly?: boolean
}

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: string
}

function CollapsibleSection({ title, children, defaultOpen = false, badge }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted text-sm font-medium"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span>{title}</span>
          {badge && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
      </button>
      {isOpen && (
        <div className="p-3 space-y-3 bg-background">
          {children}
        </div>
      )}
    </div>
  )
}

interface ConfigFieldProps {
  label: string
  value: string | number | boolean | undefined | null
  type?: 'text' | 'number' | 'boolean' | 'json' | 'textarea'
  editable?: boolean
  onChange?: (value: string | number | boolean) => void
  placeholder?: string
  mono?: boolean
}

function ConfigField({ label, value, type = 'text', editable, onChange, placeholder, mono }: ConfigFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(String(value ?? ''))

  const handleSave = () => {
    if (onChange) {
      if (type === 'number') {
        onChange(Number(editValue) || 0)
      } else if (type === 'boolean') {
        onChange(editValue === 'true')
      } else {
        onChange(editValue)
      }
    }
    setIsEditing(false)
  }

  const displayValue = value === undefined || value === null || value === ''
    ? <span className="text-muted-foreground italic">Not set</span>
    : type === 'boolean'
      ? String(value)
      : type === 'json'
        ? JSON.stringify(value, null, 2)
        : String(value)

  if (isEditing && editable) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
        <div className="flex gap-2">
          {type === 'textarea' || type === 'json' ? (
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={cn("flex-1 text-sm", mono && "font-mono")}
              rows={3}
            />
          ) : (
            <Input
              type={type === 'number' ? 'number' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={cn("flex-1 h-7 text-sm", mono && "font-mono")}
              placeholder={placeholder}
            />
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSave}>
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setIsEditing(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 w-5 p-0 opacity-50 hover:opacity-100"
            onClick={() => {
              setEditValue(String(value ?? ''))
              setIsEditing(true)
            }}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className={cn(
        "text-sm px-2 py-1 rounded bg-muted/50 break-all",
        mono && "font-mono text-xs",
        type === 'json' && "whitespace-pre-wrap max-h-32 overflow-y-auto"
      )}>
        {displayValue}
      </div>
    </div>
  )
}

export function TaskStepConfig({ stepConfig, taskType, onConfigChange, readOnly = false }: TaskStepConfigProps) {
  if (!stepConfig) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <Settings2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p>No step configuration available</p>
        <p className="text-xs mt-1">This task was not created from a workflow step</p>
      </div>
    )
  }

  const editable = !readOnly && !!onConfigChange

  const handleFieldChange = (field: keyof TaskStepConfigType) => (value: string | number | boolean) => {
    if (onConfigChange && stepConfig) {
      onConfigChange({
        ...stepConfig,
        [field]: value
      })
    }
  }

  const handleNestedChange = (parent: 'joinBoundary' | 'findDocumentConfig', field: string) => (value: string | number | boolean) => {
    if (onConfigChange && stepConfig) {
      const current = stepConfig[parent] || {}
      onConfigChange({
        ...stepConfig,
        [parent]: {
          ...current,
          [field]: value
        }
      })
    }
  }

  // Determine which sections to show based on step type
  const stepType = stepConfig.stepType

  return (
    <div className="space-y-3">
      {/* Agent/Manual Config */}
      {(stepType === 'agent' || stepType === 'manual') && (
        <CollapsibleSection title="Agent/Manual Config" defaultOpen={true}>
          <ConfigField
            label="Title Template"
            value={stepConfig.titleTemplate}
            editable={editable}
            onChange={handleFieldChange('titleTemplate')}
            mono
          />
          <ConfigField
            label="Additional Instructions"
            value={stepConfig.additionalInstructions}
            type="textarea"
            editable={editable}
            onChange={handleFieldChange('additionalInstructions')}
          />
          {stepConfig.promptDocumentIds && stepConfig.promptDocumentIds.length > 0 && (
            <ConfigField
              label="Prompt Document IDs"
              value={stepConfig.promptDocumentIds.join(', ')}
              mono
            />
          )}
          {stepConfig.defaultAssigneeId && (
            <ConfigField label="Default Assignee ID" value={stepConfig.defaultAssigneeId} mono />
          )}
        </CollapsibleSection>
      )}

      {/* External/Webhook Config */}
      {(stepType === 'external' || stepType === 'webhook') && (
        <CollapsibleSection title="HTTP Request Config" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <ConfigField
              label="URL"
              value={stepConfig.webhookUrl || stepConfig.externalEndpoint}
              editable={editable}
              onChange={handleFieldChange(stepConfig.webhookUrl ? 'webhookUrl' : 'externalEndpoint')}
              mono
            />
            <ConfigField
              label="Method"
              value={stepConfig.webhookMethod || stepConfig.externalMethod || 'POST'}
              editable={editable}
              onChange={handleFieldChange(stepConfig.webhookMethod ? 'webhookMethod' : 'externalMethod')}
            />
          </div>
          {(stepConfig.webhookHeaders || stepConfig.externalHeaders) && (
            <ConfigField
              label="Headers"
              value={JSON.stringify(stepConfig.webhookHeaders || stepConfig.externalHeaders, null, 2)}
              type="json"
              mono
            />
          )}
          {(stepConfig.webhookBodyTemplate || stepConfig.externalPayloadTemplate) && (
            <ConfigField
              label="Body Template"
              value={stepConfig.webhookBodyTemplate || stepConfig.externalPayloadTemplate}
              type="textarea"
              editable={editable}
              onChange={handleFieldChange(stepConfig.webhookBodyTemplate ? 'webhookBodyTemplate' : 'externalPayloadTemplate')}
              mono
            />
          )}
          {stepType === 'external' && (
            <ConfigField
              label="Wait for Callback"
              value={stepConfig.waitForCallback}
              type="boolean"
            />
          )}
          {stepConfig.webhookMaxRetries !== undefined && (
            <div className="grid grid-cols-3 gap-3">
              <ConfigField
                label="Max Retries"
                value={stepConfig.webhookMaxRetries}
                type="number"
                editable={editable}
                onChange={handleFieldChange('webhookMaxRetries')}
              />
              <ConfigField
                label="Timeout (ms)"
                value={stepConfig.webhookTimeoutMs}
                type="number"
                editable={editable}
                onChange={handleFieldChange('webhookTimeoutMs')}
              />
              <ConfigField
                label="Success Codes"
                value={stepConfig.webhookSuccessStatusCodes?.join(', ')}
              />
            </div>
          )}
          {stepConfig.externalResponseMapping && (
            <ConfigField
              label="Response Mapping"
              value={JSON.stringify(stepConfig.externalResponseMapping, null, 2)}
              type="json"
              mono
            />
          )}
        </CollapsibleSection>
      )}

      {/* Foreach Config */}
      {stepType === 'foreach' && (
        <CollapsibleSection title="Foreach Config" defaultOpen={true}>
          <ConfigField
            label="Items Path"
            value={stepConfig.itemsPath}
            editable={editable}
            onChange={handleFieldChange('itemsPath')}
            mono
            placeholder="e.g., output.items"
          />
          <div className="grid grid-cols-2 gap-3">
            <ConfigField
              label="Item Variable"
              value={stepConfig.itemVariable || 'item'}
              editable={editable}
              onChange={handleFieldChange('itemVariable')}
            />
            <ConfigField
              label="Max Items"
              value={stepConfig.maxItems || 100}
              type="number"
              editable={editable}
              onChange={handleFieldChange('maxItems')}
            />
          </div>
          {stepConfig.expectedCountPath && (
            <ConfigField
              label="Expected Count Path"
              value={stepConfig.expectedCountPath}
              mono
            />
          )}
        </CollapsibleSection>
      )}

      {/* Join Config */}
      {stepType === 'join' && (
        <CollapsibleSection title="Join Config" defaultOpen={true}>
          {stepConfig.awaitStepId && (
            <ConfigField label="Await Step ID" value={stepConfig.awaitStepId} mono />
          )}
          <ConfigField
            label="Input Path"
            value={stepConfig.joinInputPath}
            editable={editable}
            onChange={handleFieldChange('joinInputPath')}
            mono
            placeholder="e.g., output.result"
          />
          {stepConfig.joinBoundary && (
            <div className="space-y-2 pt-2 border-t">
              <label className="text-xs font-medium text-muted-foreground">Boundary Conditions</label>
              <div className="grid grid-cols-2 gap-3">
                <ConfigField
                  label="Min Count"
                  value={stepConfig.joinBoundary.minCount}
                  type="number"
                  editable={editable}
                  onChange={handleNestedChange('joinBoundary', 'minCount')}
                />
                <ConfigField
                  label="Min Percent"
                  value={stepConfig.joinBoundary.minPercent}
                  type="number"
                  editable={editable}
                  onChange={handleNestedChange('joinBoundary', 'minPercent')}
                />
                <ConfigField
                  label="Max Wait (ms)"
                  value={stepConfig.joinBoundary.maxWaitMs}
                  type="number"
                  editable={editable}
                  onChange={handleNestedChange('joinBoundary', 'maxWaitMs')}
                />
                <ConfigField
                  label="Fail on Timeout"
                  value={stepConfig.joinBoundary.failOnTimeout}
                  type="boolean"
                />
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Decision Config */}
      {stepType === 'decision' && (
        <CollapsibleSection title="Decision Config" defaultOpen={true}>
          {stepConfig.defaultConnection && (
            <ConfigField label="Default Connection" value={stepConfig.defaultConnection} mono />
          )}
          {stepConfig.connections && stepConfig.connections.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Connections</label>
              {stepConfig.connections.map((conn, idx) => (
                <div key={idx} className="p-2 bg-muted/30 rounded text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">Target: {conn.targetStepId}</span>
                    {conn.label && <span className="text-muted-foreground">{conn.label}</span>}
                  </div>
                  {conn.condition && (
                    <code className="block text-[10px] bg-background p-1 rounded overflow-x-auto">
                      {conn.condition}
                    </code>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Flow Config */}
      {stepType === 'flow' && (
        <CollapsibleSection title="Nested Workflow Config" defaultOpen={true}>
          {stepConfig.flowId && (
            <ConfigField label="Flow ID" value={stepConfig.flowId} mono />
          )}
          {stepConfig.inputMapping && (
            <ConfigField
              label="Input Mapping"
              value={JSON.stringify(stepConfig.inputMapping, null, 2)}
              type="json"
              mono
            />
          )}
        </CollapsibleSection>
      )}

      {/* FindDocument Config */}
      {stepType === 'findDocument' && stepConfig.findDocumentConfig && (
        <CollapsibleSection title="Find Document Config" defaultOpen={true}>
          <div className="grid grid-cols-2 gap-3">
            <ConfigField
              label="Mode"
              value={stepConfig.findDocumentConfig.mode || 'dynamic'}
            />
            {stepConfig.findDocumentConfig.documentId && (
              <ConfigField label="Document ID" value={stepConfig.findDocumentConfig.documentId} mono />
            )}
          </div>
          {stepConfig.findDocumentConfig.searchPrompt && (
            <ConfigField
              label="Search Prompt"
              value={stepConfig.findDocumentConfig.searchPrompt}
              type="textarea"
              editable={editable}
              onChange={handleNestedChange('findDocumentConfig', 'searchPrompt')}
            />
          )}
          <div className="grid grid-cols-3 gap-3">
            <ConfigField
              label="Limit"
              value={stepConfig.findDocumentConfig.limit || 1}
              type="number"
            />
            <ConfigField
              label="Min Score"
              value={stepConfig.findDocumentConfig.minScore}
              type="number"
            />
            <ConfigField
              label="Fail if Not Found"
              value={stepConfig.findDocumentConfig.failIfNotFound}
              type="boolean"
            />
          </div>
          {stepConfig.findDocumentConfig.storeAs && (
            <ConfigField label="Store As" value={stepConfig.findDocumentConfig.storeAs} mono />
          )}
          {stepConfig.findDocumentConfig.documentTypes && stepConfig.findDocumentConfig.documentTypes.length > 0 && (
            <ConfigField
              label="Document Types"
              value={stepConfig.findDocumentConfig.documentTypes.join(', ')}
            />
          )}
          {stepConfig.findDocumentConfig.tags && stepConfig.findDocumentConfig.tags.length > 0 && (
            <ConfigField
              label="Tags Filter"
              value={stepConfig.findDocumentConfig.tags.join(', ')}
            />
          )}
        </CollapsibleSection>
      )}

      {/* Input Aggregation Config (for any step with inputPath/inputSource) */}
      {(stepConfig.inputPath || stepConfig.inputSource) && stepType !== 'join' && (
        <CollapsibleSection title="Input Config">
          {stepConfig.inputSource && (
            <ConfigField label="Input Source" value={stepConfig.inputSource} mono />
          )}
          {stepConfig.inputPath && (
            <ConfigField
              label="Input Path"
              value={stepConfig.inputPath}
              editable={editable}
              onChange={handleFieldChange('inputPath')}
              mono
            />
          )}
        </CollapsibleSection>
      )}

      {/* Step Identification - Read-only info at bottom */}
      <div className="pt-3 mt-3 border-t border-border">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Step Info</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground/70">Step:</span>{' '}
            <code className="text-[10px] bg-muted px-1 rounded">{stepConfig.stepId}</code>
          </span>
          <span>
            <span className="text-foreground/70">Type:</span>{' '}
            <span className="capitalize">{stepConfig.stepType}</span>
          </span>
          {stepConfig.stepName && (
            <span>
              <span className="text-foreground/70">Name:</span>{' '}
              {stepConfig.stepName}
            </span>
          )}
        </div>
        {stepConfig.stepDescription && (
          <p className="text-xs text-muted-foreground mt-1 italic">
            {stepConfig.stepDescription}
          </p>
        )}
      </div>
    </div>
  )
}
