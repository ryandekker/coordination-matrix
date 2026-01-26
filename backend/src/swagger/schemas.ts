// OpenAPI Schema definitions for Coordination Matrix API

export const securitySchemes = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'JWT token from /api/auth/login',
  },
  apiKeyAuth: {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    description: 'API key from /api/auth/api-keys',
  },
};

export const schemas = {
  // Common schemas
  ObjectId: {
    type: 'string',
    pattern: '^[a-f\\d]{24}$',
    example: '507f1f77bcf86cd799439011',
  },
  PaginatedResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { type: 'array', items: {} },
      pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 50 },
          total: { type: 'integer', example: 100 },
          totalPages: { type: 'integer', example: 2 },
        },
      },
    },
  },
  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: { type: 'string', example: 'Error message' },
      code: { type: 'string', example: 'ERROR_CODE' },
    },
  },

  // Task schemas
  TaskStatus: {
    type: 'string',
    enum: ['pending', 'in_progress', 'waiting', 'on_hold', 'completed', 'failed', 'cancelled', 'archived'],
  },
  Urgency: {
    type: 'string',
    enum: ['low', 'normal', 'high', 'urgent'],
  },
  Task: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      title: { type: 'string', example: 'Implement feature X' },
      summary: { type: 'string', nullable: true },
      extraPrompt: { type: 'string', nullable: true, description: 'AI prompt for task execution' },
      status: { $ref: '#/components/schemas/TaskStatus' },
      urgency: { $ref: '#/components/schemas/Urgency' },
      parentId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      workflowId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      workflowRunId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      workflowStepId: { type: 'string', nullable: true },
      taskType: { type: 'string', enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', 'findDocument', 'code'], description: 'Type of task for workflow execution' },
      executionMode: { type: 'string', enum: ['manual', 'automated', 'immediate', 'external_callback'] },
      expectedQuantity: { type: 'integer', description: 'Expected number of subtasks/results' },
      assigneeId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      dueAt: { type: 'string', format: 'date-time', nullable: true },
      metadata: { type: 'object', additionalProperties: true },
      foreachConfig: { type: 'object', description: 'Configuration for foreach tasks' },
      joinConfig: { type: 'object', description: 'Configuration for join tasks (includes awaitStepId, boundary)' },
      webhookConfig: { type: 'object', description: 'Configuration for webhook tasks' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  TaskCreate: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', example: 'New task' },
      summary: { type: 'string' },
      extraPrompt: { type: 'string' },
      status: { $ref: '#/components/schemas/TaskStatus' },
      urgency: { $ref: '#/components/schemas/Urgency' },
      parentId: { type: 'string', nullable: true },
      workflowId: { type: 'string', nullable: true },
      assigneeId: { type: 'string', nullable: true },
      createdById: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      dueAt: { type: 'string', format: 'date-time' },
      metadata: { type: 'object' },
      silent: { type: 'boolean', description: 'Skip event emission' },
    },
  },
  TaskUpdate: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      extraPrompt: { type: 'string' },
      status: { $ref: '#/components/schemas/TaskStatus' },
      urgency: { $ref: '#/components/schemas/Urgency' },
      parentId: { type: 'string', nullable: true },
      workflowId: { type: 'string', nullable: true },
      assigneeId: { type: 'string', nullable: true },
      tags: { type: 'array', items: { type: 'string' } },
      dueAt: { type: 'string', format: 'date-time', nullable: true },
      metadata: { type: 'object' },
      silent: { type: 'boolean' },
      actorId: { type: 'string' },
      actorType: { type: 'string', enum: ['user', 'system', 'daemon'] },
    },
  },

  // Workflow schemas
  WorkflowStepType: {
    type: 'string',
    enum: ['trigger', 'agent', 'manual', 'external', 'webhook', 'decision', 'foreach', 'join', 'flow', 'findDocument', 'code'],
    description: 'Type of workflow step - maps 1:1 to TaskType',
  },
  TaskType: {
    type: 'string',
    enum: ['flow', 'trigger', 'agent', 'manual', 'decision', 'foreach', 'join', 'external', 'webhook', 'findDocument', 'code'],
    description: 'Type of task - maps 1:1 to WorkflowStepType',
  },
  CodeSandboxPackage: {
    type: 'string',
    enum: ['lodash', 'date-fns', 'uuid', 'zod', 'jsonpath-plus'],
    description: 'Available packages for code sandbox execution',
  },
  CodeStepConfig: {
    type: 'object',
    required: ['code'],
    properties: {
      code: { type: 'string', description: 'JavaScript code to execute. Receives `input` variable with previous step output.' },
      packages: { type: 'array', items: { $ref: '#/components/schemas/CodeSandboxPackage' }, description: 'Packages to inject into sandbox' },
      timeout: { type: 'integer', default: 30000, description: 'Max execution time in ms' },
      memoryLimit: { type: 'integer', default: 128, description: 'Memory limit in MB (for documentation)' },
      outputSchema: { type: 'object', description: 'JSON Schema to validate output against' },
      continueOnError: { type: 'boolean', default: false, description: 'Complete with error in output instead of failing' },
    },
  },
  WorkflowStep: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      stepType: { $ref: '#/components/schemas/WorkflowStepType' },
      description: { type: 'string' },
      additionalInstructions: { type: 'string' },
      defaultAssigneeId: { type: 'string' },
      connections: { type: 'array', items: { type: 'object' } },
      externalConfig: { type: 'object' },
      webhookConfig: { type: 'object' },
      itemsPath: { type: 'string', description: 'For foreach: JSONPath to items array' },
      awaitStepId: { type: 'string', description: 'For join: Step ID to await' },
      joinBoundary: { type: 'object', description: 'For join: boundary conditions' },
      expectedCountPath: { type: 'string', description: 'For join: JSONPath to expected count' },
      findDocumentConfig: { type: 'object', description: 'For findDocument: search configuration' },
      codeConfig: { $ref: '#/components/schemas/CodeStepConfig', description: 'For code: sandboxed JavaScript execution' },
      config: { type: 'object' },
    },
  },
  Workflow: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'Code Review Pipeline' },
      description: { type: 'string' },
      isActive: { type: 'boolean' },
      steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStep' } },
      mermaidDiagram: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
    },
  },

  // Workflow Run schemas
  WorkflowRunStatus: {
    type: 'string',
    enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
  },
  WorkflowRun: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      workflowId: { $ref: '#/components/schemas/ObjectId' },
      status: { $ref: '#/components/schemas/WorkflowRunStatus' },
      rootTaskId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      currentStepIds: { type: 'array', items: { type: 'string' } },
      completedStepIds: { type: 'array', items: { type: 'string' } },
      inputPayload: { type: 'object' },
      outputPayload: { type: 'object' },
      error: { type: 'string' },
      callbackSecret: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      startedAt: { type: 'string', format: 'date-time', nullable: true },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },

  // Batch Job schemas
  BatchJobStatus: {
    type: 'string',
    enum: ['pending', 'processing', 'awaiting_responses', 'completed', 'completed_with_warnings', 'failed', 'cancelled', 'manual_review'],
  },
  BatchJob: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string' },
      type: { type: 'string' },
      workflowId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      taskId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      status: { $ref: '#/components/schemas/BatchJobStatus' },
      expectedCount: { type: 'integer' },
      receivedCount: { type: 'integer' },
      processedCount: { type: 'integer' },
      failedCount: { type: 'integer' },
      minSuccessPercent: { type: 'number' },
      requiresManualReview: { type: 'boolean' },
      aggregateResult: { type: 'object' },
      createdAt: { type: 'string', format: 'date-time' },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },

  // User schemas
  UserRole: {
    type: 'string',
    enum: ['admin', 'operator', 'reviewer', 'viewer'],
  },
  User: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string' },
      role: { $ref: '#/components/schemas/UserRole' },
      isActive: { type: 'boolean' },
      isAgent: { type: 'boolean' },
      agentPrompt: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // Group schemas
  GroupRole: {
    type: 'string',
    enum: ['owner', 'admin', 'member', 'viewer'],
    description: 'Role within a group: owner > admin > member > viewer',
  },
  GroupVisibility: {
    type: 'string',
    enum: ['private', 'internal'],
    description: 'Group visibility: private = members only, internal = visible to all logged-in users',
  },
  GroupMember: {
    type: 'object',
    properties: {
      userId: { $ref: '#/components/schemas/ObjectId' },
      role: { $ref: '#/components/schemas/GroupRole' },
      addedAt: { type: 'string', format: 'date-time' },
      addedById: { $ref: '#/components/schemas/ObjectId', nullable: true },
    },
  },
  GroupMemberWithUser: {
    type: 'object',
    properties: {
      userId: { $ref: '#/components/schemas/ObjectId' },
      role: { $ref: '#/components/schemas/GroupRole' },
      addedAt: { type: 'string', format: 'date-time' },
      addedById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      user: { $ref: '#/components/schemas/User' },
    },
  },
  Group: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'engineering', description: 'Unique slug identifier' },
      displayName: { type: 'string', example: 'Engineering Team' },
      description: { type: 'string', nullable: true },
      members: { type: 'array', items: { $ref: '#/components/schemas/GroupMember' } },
      visibility: { $ref: '#/components/schemas/GroupVisibility' },
      defaultProjectRole: { $ref: '#/components/schemas/GroupRole', nullable: true },
      createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  GroupCreate: {
    type: 'object',
    required: ['name', 'displayName'],
    properties: {
      name: { type: 'string', example: 'engineering', description: 'Unique slug identifier' },
      displayName: { type: 'string', example: 'Engineering Team' },
      description: { type: 'string' },
      visibility: { $ref: '#/components/schemas/GroupVisibility' },
    },
  },
  GroupUpdate: {
    type: 'object',
    properties: {
      displayName: { type: 'string' },
      description: { type: 'string' },
      visibility: { $ref: '#/components/schemas/GroupVisibility' },
    },
  },

  // Project schemas
  ProjectStatus: {
    type: 'string',
    enum: ['active', 'archived'],
  },
  Project: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'q4-launch', description: 'Unique slug within group' },
      displayName: { type: 'string', example: 'Q4 Product Launch' },
      description: { type: 'string', nullable: true },
      groupId: { $ref: '#/components/schemas/ObjectId' },
      status: { $ref: '#/components/schemas/ProjectStatus' },
      color: { type: 'string', example: '#3B82F6', nullable: true },
      createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ProjectCreate: {
    type: 'object',
    required: ['name', 'displayName', 'groupId'],
    properties: {
      name: { type: 'string', example: 'q4-launch' },
      displayName: { type: 'string', example: 'Q4 Product Launch' },
      description: { type: 'string' },
      groupId: { type: 'string', description: 'ID of the parent group' },
      color: { type: 'string' },
    },
  },
  ProjectUpdate: {
    type: 'object',
    properties: {
      displayName: { type: 'string' },
      description: { type: 'string' },
      status: { $ref: '#/components/schemas/ProjectStatus' },
      color: { type: 'string' },
    },
  },

  // API Key schemas
  ApiKey: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'CLI Tool Key' },
      description: { type: 'string' },
      keyPrefix: { type: 'string', example: 'cm_ak_live_abc' },
      scopes: { type: 'array', items: { type: 'string' } },
      expiresAt: { type: 'string', format: 'date-time', nullable: true },
      isActive: { type: 'boolean' },
      lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // Webhook schemas
  WebhookTrigger: {
    type: 'string',
    enum: [
      'task.created', 'task.updated', 'task.deleted',
      'task.status.changed', 'task.assignee.changed', 'task.priority.changed',
      'task.entered_filter',
    ],
  },
  Webhook: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string' },
      url: { type: 'string', format: 'uri' },
      triggers: { type: 'array', items: { $ref: '#/components/schemas/WebhookTrigger' } },
      savedSearchId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      isActive: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // View schemas
  View: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'My Tasks' },
      collectionName: { type: 'string', example: 'tasks' },
      isDefault: { type: 'boolean' },
      filters: { type: 'object' },
      sorting: { type: 'array', items: { type: 'object' } },
      visibleColumns: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },

  // Lookup schemas
  Lookup: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      type: { type: 'string', example: 'task_status' },
      code: { type: 'string', example: 'pending' },
      displayName: { type: 'string', example: 'Pending' },
      color: { type: 'string', example: '#FFA500' },
      icon: { type: 'string' },
      sortOrder: { type: 'integer' },
      isActive: { type: 'boolean' },
    },
  },

  // Tag schemas
  Tag: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      name: { type: 'string', example: 'bug', description: 'Lowercase tag identifier' },
      displayName: { type: 'string', example: 'Bug', description: 'Human-readable display name' },
      color: { type: 'string', example: '#EF4444', description: 'Hex color code' },
      description: { type: 'string', example: 'Bug fixes and issues', nullable: true },
      isActive: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  TagInput: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', example: 'bug', description: 'Tag name (will be normalized to lowercase)' },
      displayName: { type: 'string', example: 'Bug', description: 'Optional display name' },
      color: { type: 'string', example: '#EF4444', description: 'Hex color code (defaults to gray)' },
      description: { type: 'string', example: 'Bug fixes and issues' },
    },
  },

  // Document schemas
  DocumentType: {
    type: 'string',
    enum: ['sop', 'strategy', 'plan', 'template', 'reference', 'output', 'custom', 'workflow-prompt'],
    description: 'Type of document',
  },
  DocumentStatus: {
    type: 'string',
    enum: ['draft', 'review', 'approved', 'archived'],
    description: 'Document status',
  },
  Document: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      title: { type: 'string', example: 'Social Media SOP' },
      content: { type: 'string', description: 'Markdown content' },
      summary: { type: 'string', nullable: true, description: 'Brief summary' },
      type: { $ref: '#/components/schemas/DocumentType' },
      status: { $ref: '#/components/schemas/DocumentStatus' },
      tags: { type: 'array', items: { type: 'string' } },
      createdById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      lastModifiedById: { $ref: '#/components/schemas/ObjectId', nullable: true },
      parentDocumentId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      relatedTaskIds: { type: 'array', items: { $ref: '#/components/schemas/ObjectId' } },
      workflowRunId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      version: { type: 'integer', example: 1 },
      metadata: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  DocumentCreate: {
    type: 'object',
    required: ['title', 'content'],
    properties: {
      title: { type: 'string', example: 'New Document' },
      content: { type: 'string', description: 'Markdown content' },
      summary: { type: 'string' },
      type: { $ref: '#/components/schemas/DocumentType' },
      status: { $ref: '#/components/schemas/DocumentStatus' },
      tags: { type: 'array', items: { type: 'string' } },
      parentDocumentId: { type: 'string', nullable: true },
      workflowRunId: { type: 'string', nullable: true },
      metadata: { type: 'object' },
    },
  },
  DocumentUpdate: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string' },
      type: { $ref: '#/components/schemas/DocumentType' },
      status: { $ref: '#/components/schemas/DocumentStatus' },
      tags: { type: 'array', items: { type: 'string' } },
      parentDocumentId: { type: 'string', nullable: true },
      metadata: { type: 'object' },
      changeDescription: { type: 'string', description: 'Description of changes for version history' },
    },
  },
  DocumentVersion: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      documentId: { $ref: '#/components/schemas/ObjectId' },
      version: { type: 'integer' },
      title: { type: 'string' },
      content: { type: 'string' },
      summary: { type: 'string', nullable: true },
      changeDescription: { type: 'string', nullable: true },
      modifiedById: { $ref: '#/components/schemas/ObjectId' },
      modifiedByName: { type: 'string' },
      modifiedAt: { type: 'string', format: 'date-time' },
    },
  },
  DocumentSearchQuery: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', description: 'Natural language search prompt' },
      type: { type: 'array', items: { $ref: '#/components/schemas/DocumentType' } },
      status: { type: 'array', items: { $ref: '#/components/schemas/DocumentStatus' } },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', default: 10 },
      minScore: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  DocumentSearchResult: {
    type: 'object',
    properties: {
      document: { $ref: '#/components/schemas/Document' },
      score: { type: 'number', description: 'Similarity score (0-1)' },
      highlights: { type: 'array', items: { type: 'string' } },
    },
  },

  // Activity Log schemas
  ActivityLog: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      taskId: { $ref: '#/components/schemas/ObjectId' },
      eventType: { type: 'string' },
      actorId: { $ref: '#/components/schemas/ObjectId', nullable: true },
      actorType: { type: 'string', enum: ['user', 'system', 'daemon'] },
      changes: { type: 'object' },
      comment: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },

  // Field Config schemas
  FieldConfig: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      collectionName: { type: 'string', example: 'tasks', description: 'Collection this config applies to' },
      fieldPath: { type: 'string', example: 'customField', description: 'Path to the field in the document' },
      displayName: { type: 'string', example: 'Custom Field', description: 'Human-readable display name' },
      fieldType: { type: 'string', enum: ['text', 'number', 'boolean', 'date', 'select', 'multiselect', 'reference'], default: 'text' },
      isRequired: { type: 'boolean', default: false },
      isEditable: { type: 'boolean', default: true },
      isSearchable: { type: 'boolean', default: false },
      isSortable: { type: 'boolean', default: true },
      isFilterable: { type: 'boolean', default: false },
      displayOrder: { type: 'integer', default: 0 },
      width: { type: 'integer', nullable: true },
      minWidth: { type: 'integer', nullable: true },
      lookupType: { type: 'string', nullable: true, description: 'For select fields, the lookup type to use for options' },
      options: { type: 'array', items: { type: 'object' }, nullable: true, description: 'Static options for select fields' },
      referenceCollection: { type: 'string', nullable: true, description: 'For reference fields, the target collection' },
      referenceDisplayField: { type: 'string', default: 'displayName', description: 'Field to display from referenced document' },
      defaultValue: { type: 'string', nullable: true },
      defaultVisible: { type: 'boolean', default: true },
      renderAs: { type: 'string', default: 'text', description: 'UI render type (text, badge, date, etc.)' },
      validation: { type: 'object', nullable: true, description: 'Validation rules' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },

  // External Job schemas
  ExternalJobStatus: {
    type: 'string',
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
  },
  ExternalJob: {
    type: 'object',
    properties: {
      _id: { $ref: '#/components/schemas/ObjectId' },
      taskId: { $ref: '#/components/schemas/ObjectId' },
      type: { type: 'string' },
      status: { $ref: '#/components/schemas/ExternalJobStatus' },
      payload: { type: 'object' },
      result: { type: 'object' },
      error: { type: 'string' },
      attempts: { type: 'integer' },
      maxAttempts: { type: 'integer' },
      scheduledFor: { type: 'string', format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
};

export const tags = [
  { name: 'Health', description: 'Health check endpoint' },
  { name: 'Auth', description: 'Authentication and authorization' },
  { name: 'API Keys', description: 'API key management' },
  { name: 'Tasks', description: 'Task CRUD and tree operations' },
  { name: 'Workflows', description: 'Workflow definitions' },
  { name: 'Workflow Runs', description: 'Workflow execution instances' },
  { name: 'Batch Jobs', description: 'Fan-out/fan-in job coordination' },
  { name: 'Users', description: 'User management' },
  { name: 'Groups', description: 'Group-based access control and organization' },
  { name: 'Projects', description: 'Project organization within groups' },
  { name: 'Views', description: 'Saved searches and views' },
  { name: 'Webhooks', description: 'Webhook configuration and delivery' },
  { name: 'Activity Logs', description: 'Audit trail and comments' },
  { name: 'Lookups', description: 'Lookup/enum values' },
  { name: 'Tags', description: 'Tag management' },
  { name: 'Field Configs', description: 'Dynamic field configuration' },
  { name: 'External Jobs', description: 'External worker job queue' },
  { name: 'Events', description: 'Real-time Server-Sent Events (SSE)' },
  { name: 'Documents', description: 'Markdown documentation management with semantic search' },
  { name: 'AI', description: 'AI-related endpoints for workflow generation' },
];
