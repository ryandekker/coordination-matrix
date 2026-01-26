'use client'

import { useState, useCallback, useMemo } from 'react'
import { Send, HelpCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Task,
  AgentQuestion,
  AgentQuestionAnswer,
  AgentQuestionsOutput,
} from '@/lib/api'
import { cn } from '@/lib/utils'

interface AgentQuestionsPanelProps {
  task: Task
  questionsData: AgentQuestionsOutput
  onSubmitAnswers: (answers: AgentQuestionAnswer[]) => Promise<void>
  isSubmitting?: boolean
}

export function AgentQuestionsPanel({
  task,
  questionsData,
  onSubmitAnswers,
  isSubmitting = false,
}: AgentQuestionsPanelProps) {
  const { questions, context, answers: existingAnswers, answeredAt } = questionsData

  // Initialize answers state from existing answers or defaults
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | string[]>>(() => {
    const initial: Record<string, string | number | boolean | string[]> = {}
    for (const q of questions) {
      // Check if there's an existing answer
      const existingAnswer = existingAnswers?.find(a => a.questionId === q.id)
      if (existingAnswer) {
        initial[q.id] = existingAnswer.value
      } else if (q.defaultValue !== undefined) {
        initial[q.id] = q.defaultValue
      } else {
        // Set default based on type
        switch (q.type) {
          case 'confirm':
            initial[q.id] = false
            break
          case 'multiselect':
            initial[q.id] = []
            break
          case 'number':
            initial[q.id] = q.validation?.min ?? 0
            break
          default:
            initial[q.id] = ''
        }
      }
    }
    return initial
  })

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Check if already answered
  const isAlreadyAnswered = !!answeredAt

  // Validate all answers
  const validateAnswers = useCallback((): boolean => {
    const errors: Record<string, string> = {}

    for (const q of questions) {
      const value = answers[q.id]

      // Required check
      if (q.required) {
        if (value === undefined || value === null || value === '') {
          errors[q.id] = 'This field is required'
          continue
        }
        if (q.type === 'multiselect' && Array.isArray(value) && value.length === 0) {
          errors[q.id] = 'Please select at least one option'
          continue
        }
      }

      // Type-specific validation
      if (q.type === 'number' && value !== '') {
        const numValue = Number(value)
        if (isNaN(numValue)) {
          errors[q.id] = 'Please enter a valid number'
        } else if (q.validation?.min !== undefined && numValue < q.validation.min) {
          errors[q.id] = `Value must be at least ${q.validation.min}`
        } else if (q.validation?.max !== undefined && numValue > q.validation.max) {
          errors[q.id] = `Value must be at most ${q.validation.max}`
        }
      }

      if (q.type === 'text' && typeof value === 'string') {
        if (q.validation?.minLength !== undefined && value.length < q.validation.minLength) {
          errors[q.id] = `Must be at least ${q.validation.minLength} characters`
        } else if (q.validation?.maxLength !== undefined && value.length > q.validation.maxLength) {
          errors[q.id] = `Must be at most ${q.validation.maxLength} characters`
        } else if (q.validation?.pattern) {
          const regex = new RegExp(q.validation.pattern)
          if (!regex.test(value)) {
            errors[q.id] = 'Invalid format'
          }
        }
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }, [questions, answers])

  // Handle submit
  const handleSubmit = useCallback(async () => {
    if (!validateAnswers()) return

    const formattedAnswers: AgentQuestionAnswer[] = questions.map(q => ({
      questionId: q.id,
      value: answers[q.id],
    }))

    await onSubmitAnswers(formattedAnswers)
  }, [validateAnswers, questions, answers, onSubmitAnswers])

  // Update a single answer
  const updateAnswer = useCallback((questionId: string, value: string | number | boolean | string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    // Clear validation error when user updates
    setValidationErrors(prev => {
      const next = { ...prev }
      delete next[questionId]
      return next
    })
  }, [])

  // Render a single question input
  const renderQuestionInput = (question: AgentQuestion) => {
    const value = answers[question.id]
    const error = validationErrors[question.id]
    const isDisabled = isSubmitting || isAlreadyAnswered

    switch (question.type) {
      case 'text':
        return (
          <Textarea
            value={String(value || '')}
            onChange={(e) => updateAnswer(question.id, e.target.value)}
            placeholder={question.placeholder || 'Enter your answer...'}
            disabled={isDisabled}
            className={cn('resize-none', error && 'border-red-500')}
            rows={3}
          />
        )

      case 'number':
        return (
          <Input
            type="number"
            value={String(value || '')}
            onChange={(e) => updateAnswer(question.id, e.target.value === '' ? '' : Number(e.target.value))}
            placeholder={question.placeholder || 'Enter a number...'}
            disabled={isDisabled}
            min={question.validation?.min}
            max={question.validation?.max}
            className={cn(error && 'border-red-500')}
          />
        )

      case 'confirm':
        return (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`q-${question.id}`}
              checked={Boolean(value)}
              onCheckedChange={(checked) => updateAnswer(question.id, Boolean(checked))}
              disabled={isDisabled}
            />
            <label
              htmlFor={`q-${question.id}`}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Yes
            </label>
          </div>
        )

      case 'choice':
        return (
          <RadioGroup
            value={String(value || '')}
            onValueChange={(val) => updateAnswer(question.id, val)}
            disabled={isDisabled}
            className="space-y-2"
          >
            {question.options?.map((option) => (
              <div key={option.value} className="flex items-start space-x-2">
                <RadioGroupItem value={option.value} id={`${question.id}-${option.value}`} className="mt-1" />
                <div className="grid gap-0.5">
                  <Label htmlFor={`${question.id}-${option.value}`} className="font-normal cursor-pointer">
                    {option.label}
                  </Label>
                  {option.description && (
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  )}
                </div>
              </div>
            ))}
          </RadioGroup>
        )

      case 'multiselect':
        const selectedValues = Array.isArray(value) ? value : []
        return (
          <div className="space-y-2">
            {question.options?.map((option) => (
              <div key={option.value} className="flex items-start space-x-2">
                <Checkbox
                  id={`${question.id}-${option.value}`}
                  checked={selectedValues.includes(option.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      updateAnswer(question.id, [...selectedValues, option.value])
                    } else {
                      updateAnswer(question.id, selectedValues.filter(v => v !== option.value))
                    }
                  }}
                  disabled={isDisabled}
                  className="mt-1"
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`${question.id}-${option.value}`} className="font-normal cursor-pointer">
                    {option.label}
                  </Label>
                  {option.description && (
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )

      default:
        return (
          <Input
            value={String(value || '')}
            onChange={(e) => updateAnswer(question.id, e.target.value)}
            placeholder={question.placeholder || 'Enter your answer...'}
            disabled={isDisabled}
            className={cn(error && 'border-red-500')}
          />
        )
    }
  }

  // If already answered, show a summary
  if (isAlreadyAnswered) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="font-medium">Questions Answered</span>
          <span className="text-xs text-muted-foreground">
            {new Date(answeredAt!).toLocaleString()}
          </span>
        </div>

        <div className="space-y-3">
          {questions.map((question) => {
            const answer = existingAnswers?.find(a => a.questionId === question.id)
            return (
              <div key={question.id} className="p-3 bg-muted/50 rounded-lg border space-y-1">
                <div className="text-sm font-medium">{question.question}</div>
                <div className="text-sm text-muted-foreground">
                  {formatAnswerDisplay(question, answer?.value)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-medium">Agent Needs Your Input</h3>
      </div>

      {/* Context */}
      {context && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-200">{context}</p>
        </div>
      )}

      {/* Questions */}
      <div className="space-y-4">
        {questions.map((question, index) => (
          <div key={question.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-xs font-medium text-muted-foreground mt-0.5">
                {index + 1}.
              </span>
              <div className="flex-1 space-y-1">
                <Label className="text-sm font-medium">
                  {question.question}
                  {question.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {question.description && (
                  <p className="text-xs text-muted-foreground">{question.description}</p>
                )}
              </div>
            </div>
            <div className="ml-5">
              {renderQuestionInput(question)}
              {validationErrors[question.id] && (
                <p className="text-xs text-red-500 mt-1">{validationErrors[question.id]}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Submit Answers
            </>
          )}
        </Button>
      </div>

      {/* Help Text */}
      <p className="text-xs text-muted-foreground">
        After you submit your answers, the agent will continue processing the task with your input.
      </p>
    </div>
  )
}

// Helper to format answer for display
function formatAnswerDisplay(question: AgentQuestion, value: unknown): string {
  if (value === undefined || value === null) return '(no answer)'

  switch (question.type) {
    case 'confirm':
      return value ? 'Yes' : 'No'
    case 'choice':
      const option = question.options?.find(o => o.value === value)
      return option?.label || String(value)
    case 'multiselect':
      if (Array.isArray(value)) {
        return value
          .map(v => question.options?.find(o => o.value === v)?.label || v)
          .join(', ') || '(none selected)'
      }
      return String(value)
    default:
      return String(value)
  }
}
