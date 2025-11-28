'use client'

import { useQuery } from '@tanstack/react-query'
import { Workflow, Play, Pause, ChevronRight, User, Bot } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

interface WorkflowStep {
  name: string
  type: 'automated' | 'manual'
  hitlPhase: string
}

interface WorkflowData {
  _id: string
  name: string
  description: string
  isActive: boolean
  steps: WorkflowStep[]
  createdAt: string
}

async function fetchWorkflows(): Promise<{ data: WorkflowData[] }> {
  const response = await fetch(`${API_BASE}/workflows`)
  if (!response.ok) {
    // Return sample data if endpoint doesn't exist yet
    return {
      data: [
        {
          _id: '1',
          name: 'Content Generation Pipeline',
          description: 'Standard workflow for AI-assisted content generation with human review',
          isActive: true,
          steps: [
            { name: 'Data Collection', type: 'automated', hitlPhase: 'none' },
            { name: 'AI Analysis', type: 'automated', hitlPhase: 'none' },
            { name: 'Content Generation', type: 'automated', hitlPhase: 'post_execution' },
            { name: 'Human Review', type: 'manual', hitlPhase: 'approval_required' },
            { name: 'Publication', type: 'automated', hitlPhase: 'none' },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          _id: '2',
          name: 'Data Processing Pipeline',
          description: 'Batch data processing with error handling',
          isActive: true,
          steps: [
            { name: 'Ingestion', type: 'automated', hitlPhase: 'none' },
            { name: 'Validation', type: 'automated', hitlPhase: 'on_error' },
            { name: 'Transformation', type: 'automated', hitlPhase: 'none' },
            { name: 'Output', type: 'automated', hitlPhase: 'none' },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          _id: '3',
          name: 'Customer Support Triage',
          description: 'AI-assisted customer support with escalation to human agents',
          isActive: false,
          steps: [
            { name: 'Ticket Intake', type: 'automated', hitlPhase: 'none' },
            { name: 'AI Classification', type: 'automated', hitlPhase: 'none' },
            { name: 'Auto Response', type: 'automated', hitlPhase: 'pre_execution' },
            { name: 'Human Escalation', type: 'manual', hitlPhase: 'approval_required' },
            { name: 'Resolution', type: 'manual', hitlPhase: 'none' },
          ],
          createdAt: new Date().toISOString(),
        },
      ],
    }
  }
  return response.json()
}

export default function WorkflowsPage() {
  const { data: workflowsData, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows,
  })

  const workflows = workflowsData?.data || []

  const hitlPhaseLabels: Record<string, string> = {
    none: 'No HITL',
    pre_execution: 'Pre-Execution',
    during_execution: 'During',
    post_execution: 'Post-Execution',
    on_error: 'On Error',
    approval_required: 'Approval',
  }

  const hitlPhaseColors: Record<string, string> = {
    none: '#6B7280',
    pre_execution: '#3B82F6',
    during_execution: '#F59E0B',
    post_execution: '#10B981',
    on_error: '#EF4444',
    approval_required: '#8B5CF6',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">
            Define and manage AI workflow pipelines with human-in-the-loop checkpoints
          </p>
        </div>
        <Button>
          <Workflow className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="grid gap-6">
          {workflows.map((workflow) => (
            <div
              key={workflow._id}
              className="rounded-lg border bg-card p-6 space-y-4"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">{workflow.name}</h3>
                    <Badge
                      variant="outline"
                      className={cn(
                        workflow.isActive
                          ? 'text-green-600 border-green-600'
                          : 'text-gray-500 border-gray-500'
                      )}
                    >
                      {workflow.isActive ? (
                        <>
                          <Play className="mr-1 h-3 w-3" />
                          Active
                        </>
                      ) : (
                        <>
                          <Pause className="mr-1 h-3 w-3" />
                          Inactive
                        </>
                      )}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{workflow.description}</p>
                </div>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {workflow.steps.map((step, index) => (
                  <div key={index} className="flex items-center">
                    <div
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border p-3 min-w-[140px]',
                        step.type === 'manual' ? 'border-purple-300 bg-purple-50' : 'border-gray-200'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {step.type === 'automated' ? (
                          <Bot className="h-4 w-4 text-blue-500" />
                        ) : (
                          <User className="h-4 w-4 text-purple-500" />
                        )}
                        <span className="text-sm font-medium">{step.name}</span>
                      </div>
                      {step.hitlPhase !== 'none' && (
                        <Badge
                          color={hitlPhaseColors[step.hitlPhase]}
                          variant="outline"
                          className="text-xs"
                        >
                          {hitlPhaseLabels[step.hitlPhase]}
                        </Badge>
                      )}
                    </div>
                    {index < workflow.steps.length - 1 && (
                      <ChevronRight className="h-5 w-5 text-muted-foreground mx-1 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{workflow.steps.length} steps</span>
                <span>
                  {workflow.steps.filter((s) => s.type === 'manual').length} manual checkpoints
                </span>
                <span>
                  {workflow.steps.filter((s) => s.hitlPhase !== 'none').length} HITL points
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
