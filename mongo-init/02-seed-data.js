// MongoDB Seed Data
// Initial configurations and sample data

db = db.getSiblingDB('coordination_matrix');

// ============================================================================
// LOOKUP TABLES - Status codes, urgency levels, etc.
// ============================================================================

const lookups = [
  // Task statuses
  { type: 'task_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'task_status', code: 'in_progress', displayName: 'In Progress', color: '#3B82F6', icon: 'play', sortOrder: 2, isActive: true },
  { type: 'task_status', code: 'waiting', displayName: 'Waiting', color: '#8B5CF6', icon: 'hourglass', sortOrder: 3, isActive: true },
  { type: 'task_status', code: 'on_hold', displayName: 'On Hold', color: '#F59E0B', icon: 'pause', sortOrder: 4, isActive: true },
  { type: 'task_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 5, isActive: true },
  { type: 'task_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x-circle', sortOrder: 6, isActive: true },
  { type: 'task_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 7, isActive: true },

  // Urgency levels
  { type: 'urgency', code: 'low', displayName: 'Low', color: '#6B7280', icon: 'arrow-down', sortOrder: 1, isActive: true },
  { type: 'urgency', code: 'normal', displayName: 'Normal', color: '#3B82F6', icon: 'minus', sortOrder: 2, isActive: true },
  { type: 'urgency', code: 'high', displayName: 'High', color: '#F97316', icon: 'arrow-up', sortOrder: 3, isActive: true },
  { type: 'urgency', code: 'urgent', displayName: 'Urgent', color: '#EF4444', icon: 'alert-triangle', sortOrder: 4, isActive: true },
];

db.lookups.insertMany(lookups);

// ============================================================================
// FIELD CONFIGURATIONS - Define how fields are displayed and edited
// ============================================================================

const fieldConfigs = [
  // Task collection fields
  {
    collectionName: 'tasks',
    fieldPath: 'title',
    displayName: 'Title',
    fieldType: 'text',
    isRequired: true,
    isEditable: true,
    isSearchable: true,
    isSortable: true,
    isFilterable: true,
    displayOrder: 1,
    width: 600,
    minWidth: 300,
    validation: { minLength: 1, maxLength: 500 },
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'summary',
    displayName: 'Summary',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 2,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'extraPrompt',
    displayName: 'Extra Prompt',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 3,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'additionalInfo',
    displayName: 'Additional Info',
    fieldType: 'textarea',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: false,
    displayOrder: 4,
    width: 400,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'status',
    displayName: 'Status',
    fieldType: 'select',
    isRequired: true,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 5,
    width: 140,
    lookupType: 'task_status',
    defaultValue: 'pending',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'urgency',
    displayName: 'Urgency',
    fieldType: 'select',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 6,
    width: 120,
    lookupType: 'urgency',
    defaultValue: 'normal',
    defaultVisible: true,
    renderAs: 'badge',
  },
  {
    collectionName: 'tasks',
    fieldPath: 'assigneeId',
    displayName: 'Assignee',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 7,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'tags',
    displayName: 'Tags',
    fieldType: 'tags',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 8,
    width: 200,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'dueAt',
    displayName: 'Due',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 9,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdAt',
    displayName: 'Created',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 10,
    width: 160,
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'updatedAt',
    displayName: 'Updated',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 11,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'createdById',
    displayName: 'Created By',
    fieldType: 'reference',
    isRequired: false,
    isEditable: false,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 12,
    width: 180,
    referenceCollection: 'users',
    referenceDisplayField: 'displayName',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalId',
    displayName: 'External ID',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: true,
    isSortable: false,
    isFilterable: true,
    displayOrder: 13,
    width: 150,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'externalHoldDate',
    displayName: 'External Hold Date',
    fieldType: 'datetime',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 14,
    width: 160,
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'parentId',
    displayName: 'Parent Task',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: false,
    isFilterable: true,
    displayOrder: 15,
    width: 200,
    referenceCollection: 'tasks',
    referenceDisplayField: 'title',
    defaultVisible: false,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowId',
    displayName: 'Workflow',
    fieldType: 'reference',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 16,
    width: 180,
    referenceCollection: 'workflows',
    referenceDisplayField: 'name',
    defaultVisible: true,
  },
  {
    collectionName: 'tasks',
    fieldPath: 'workflowStage',
    displayName: 'Stage',
    fieldType: 'text',
    isRequired: false,
    isEditable: true,
    isSearchable: false,
    isSortable: true,
    isFilterable: true,
    displayOrder: 17,
    width: 150,
    defaultVisible: true,
  },
];

db.field_configs.insertMany(fieldConfigs);

// ============================================================================
// DEFAULT VIEWS
// ============================================================================

const views = [
  {
    name: 'All Tasks',
    collectionName: 'tasks',
    isDefault: true,
    isSystem: true,
    filters: {},
    sorting: [{ field: 'createdAt', direction: 'desc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'workflowId', 'workflowStage', 'tags', 'dueAt', 'createdAt'],
    createdAt: new Date(),
  },
  {
    name: 'My Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { assigneeId: '{{currentUserId}}' },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'dueAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'dueAt', 'tags'],
    createdAt: new Date(),
  },
  {
    name: 'On Hold',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { status: ['on_hold'] },
    sorting: [{ field: 'externalHoldDate', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'externalHoldDate', 'externalId', 'assigneeId'],
    createdAt: new Date(),
  },
  {
    name: 'Urgent Tasks',
    collectionName: 'tasks',
    isDefault: false,
    isSystem: true,
    filters: { urgency: ['high', 'urgent'] },
    sorting: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'asc' }],
    visibleColumns: ['title', 'status', 'urgency', 'assigneeId', 'dueAt'],
    createdAt: new Date(),
  },
];

db.views.insertMany(views);

// ============================================================================
// SAMPLE USERS
// ============================================================================

const users = [
  {
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'operator@example.com',
    displayName: 'Alex Operator',
    role: 'operator',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'sarah.chen@example.com',
    displayName: 'Sarah Chen',
    role: 'operator',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'marcus.johnson@example.com',
    displayName: 'Marcus Johnson',
    role: 'reviewer',
    isActive: true,
    createdAt: new Date(),
  },
  {
    email: 'emma.wilson@example.com',
    displayName: 'Emma Wilson',
    role: 'viewer',
    isActive: true,
    createdAt: new Date(),
  },
];

const userResult = db.users.insertMany(users);
const userIds = Object.values(userResult.insertedIds);

// ============================================================================
// SAMPLE WORKFLOWS
// ============================================================================

const workflows = [
  {
    name: 'Content Generation Pipeline',
    description: 'Standard workflow for AI-assisted content generation',
    isActive: true,
    stages: ['Draft', 'Review', 'Approved', 'Published'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: 'Bug Fix Process',
    description: 'Workflow for tracking and resolving bugs',
    isActive: true,
    stages: ['Reported', 'Investigating', 'Fix in Progress', 'Testing', 'Deployed'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    name: 'Feature Development',
    description: 'Workflow for new feature development',
    isActive: true,
    stages: ['Planning', 'Design', 'Development', 'Code Review', 'QA', 'Released'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const workflowResult = db.workflows.insertMany(workflows);
const workflowIds = Object.values(workflowResult.insertedIds);

// ============================================================================
// SAMPLE TASKS WITH HIERARCHY
// ============================================================================

const now = new Date();
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

// Root task 1: Q4 Marketing Campaign
const rootTask1Id = ObjectId();
const rootTask1 = {
  _id: rootTask1Id,
  title: 'Q4 Marketing Campaign',
  summary: 'Plan and execute the Q4 marketing campaign including email, social media, and content marketing.',
  extraPrompt: 'Focus on product launches and holiday promotions',
  additionalInfo: 'Budget: $50,000. Timeline: October-December',
  status: 'in_progress',
  urgency: 'high',
  parentId: null,
  workflowId: workflowIds[0],
  workflowStage: 'Review',
  externalId: 'MKT-2024-Q4',
  externalHoldDate: null,
  assigneeId: userIds[1],
  createdById: userIds[0],
  tags: ['marketing', 'q4', 'campaign'],
  createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Child task 1.1: Email Marketing
const childTask1_1Id = ObjectId();
const childTask1_1 = {
  _id: childTask1_1Id,
  title: 'Email Marketing Campaign',
  summary: 'Create and schedule email campaigns for Q4 promotions',
  extraPrompt: '',
  additionalInfo: 'Target: 50,000 subscribers',
  status: 'in_progress',
  urgency: 'high',
  parentId: rootTask1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['email', 'marketing'],
  createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: tomorrow,
};

// Grandchild task 1.1.1: Design email templates
const grandchildTask1_1_1 = {
  _id: ObjectId(),
  title: 'Design Email Templates',
  summary: 'Create responsive email templates for holiday promotions',
  extraPrompt: '',
  additionalInfo: '',
  status: 'completed',
  urgency: 'normal',
  parentId: childTask1_1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['design', 'email'],
  createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
  updatedAt: yesterday,
  dueAt: yesterday,
};

// Grandchild task 1.1.2: Write email copy
const grandchildTask1_1_2 = {
  _id: ObjectId(),
  title: 'Write Email Copy',
  summary: 'Write compelling email copy for promotional campaigns',
  extraPrompt: 'Use conversational tone, highlight value propositions',
  additionalInfo: '',
  status: 'in_progress',
  urgency: 'high',
  parentId: childTask1_1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[3],
  createdById: userIds[1],
  tags: ['copywriting', 'email'],
  createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: tomorrow,
};

// Child task 1.2: Social Media Campaign
const childTask1_2Id = ObjectId();
const childTask1_2 = {
  _id: childTask1_2Id,
  title: 'Social Media Campaign',
  summary: 'Plan and execute social media posts across all platforms',
  extraPrompt: '',
  additionalInfo: 'Platforms: Instagram, Twitter, LinkedIn, Facebook',
  status: 'pending',
  urgency: 'normal',
  parentId: rootTask1Id,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[2],
  createdById: userIds[1],
  tags: ['social-media', 'marketing'],
  createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Root task 2: Website Redesign
const rootTask2Id = ObjectId();
const rootTask2 = {
  _id: rootTask2Id,
  title: 'Website Redesign Project',
  summary: 'Complete redesign of the company website with new branding',
  extraPrompt: '',
  additionalInfo: 'Must maintain SEO rankings during migration',
  status: 'on_hold',
  urgency: 'normal',
  parentId: null,
  workflowId: workflowIds[2],
  workflowStage: 'Design',
  externalId: 'WEB-2024-001',
  externalHoldDate: nextWeek,
  assigneeId: userIds[1],
  createdById: userIds[0],
  tags: ['website', 'design', 'rebrand'],
  createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
};

// Root task 3: Bug fix - Login issues
const rootTask3 = {
  _id: ObjectId(),
  title: 'Fix Login Authentication Bug',
  summary: 'Users reporting intermittent login failures',
  extraPrompt: 'Check session handling and token expiration',
  additionalInfo: 'Error logs show timeout on auth service',
  status: 'in_progress',
  urgency: 'urgent',
  parentId: null,
  workflowId: workflowIds[1],
  workflowStage: 'Fix in Progress',
  externalId: 'BUG-789',
  externalHoldDate: null,
  assigneeId: userIds[3],
  createdById: userIds[0],
  tags: ['bug', 'authentication', 'urgent'],
  createdAt: yesterday,
  updatedAt: now,
  dueAt: tomorrow,
};

// Root task 4: Documentation update
const rootTask4 = {
  _id: ObjectId(),
  title: 'Update API Documentation',
  summary: 'Update REST API docs with new endpoints from v2.5 release',
  extraPrompt: '',
  additionalInfo: 'Include code examples in Python and JavaScript',
  status: 'pending',
  urgency: 'low',
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: '',
  externalHoldDate: null,
  assigneeId: userIds[4],
  createdById: userIds[0],
  tags: ['documentation', 'api'],
  createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  updatedAt: now,
  dueAt: nextWeek,
};

// Root task 5: Completed task
const rootTask5 = {
  _id: ObjectId(),
  title: 'Quarterly Performance Review',
  summary: 'Conduct Q3 performance reviews for the team',
  extraPrompt: '',
  additionalInfo: '',
  status: 'completed',
  urgency: 'normal',
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: 'HR-Q3-2024',
  externalHoldDate: null,
  assigneeId: userIds[0],
  createdById: userIds[0],
  tags: ['hr', 'review'],
  createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
  dueAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
};

// Root task 6: Cancelled task
const rootTask6 = {
  _id: ObjectId(),
  title: 'Legacy System Migration',
  summary: 'Migrate data from legacy CRM to new system',
  extraPrompt: '',
  additionalInfo: 'Project cancelled due to vendor change',
  status: 'cancelled',
  urgency: 'low',
  parentId: null,
  workflowId: null,
  workflowStage: '',
  externalId: 'MIG-001',
  externalHoldDate: null,
  assigneeId: null,
  createdById: userIds[0],
  tags: ['migration', 'cancelled'],
  createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  dueAt: null,
};

// Additional tasks for variety
const additionalTasks = [
  {
    _id: ObjectId(),
    title: 'Implement Dark Mode',
    summary: 'Add dark mode support to the web application',
    extraPrompt: 'Follow system preferences by default',
    additionalInfo: '',
    status: 'pending',
    urgency: 'low',
    parentId: null,
    workflowId: workflowIds[2],
    workflowStage: 'Planning',
    externalId: '',
    externalHoldDate: null,
    assigneeId: userIds[2],
    createdById: userIds[0],
    tags: ['feature', 'ui', 'accessibility'],
    createdAt: now,
    updatedAt: now,
    dueAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
  },
  {
    _id: ObjectId(),
    title: 'Security Audit Review',
    summary: 'Review findings from external security audit',
    extraPrompt: '',
    additionalInfo: 'Report attached in shared drive',
    status: 'in_progress',
    urgency: 'high',
    parentId: null,
    workflowId: null,
    workflowStage: '',
    externalId: 'SEC-2024-001',
    externalHoldDate: null,
    assigneeId: userIds[3],
    createdById: userIds[0],
    tags: ['security', 'audit', 'compliance'],
    createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    updatedAt: now,
    dueAt: tomorrow,
  },
  {
    _id: ObjectId(),
    title: 'Customer Feedback Analysis',
    summary: 'Analyze customer feedback from Q3 surveys',
    extraPrompt: 'Identify top 3 improvement areas',
    additionalInfo: '',
    status: 'completed',
    urgency: 'normal',
    parentId: null,
    workflowId: null,
    workflowStage: '',
    externalId: '',
    externalHoldDate: null,
    assigneeId: userIds[4],
    createdById: userIds[1],
    tags: ['research', 'customer-feedback'],
    createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    dueAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
  },
];

db.tasks.insertMany([
  rootTask1,
  childTask1_1,
  grandchildTask1_1_1,
  grandchildTask1_1_2,
  childTask1_2,
  rootTask2,
  rootTask3,
  rootTask4,
  rootTask5,
  rootTask6,
  ...additionalTasks,
]);

// ============================================================================
// BATCH JOB LOOKUPS - Status codes for batch processing
// ============================================================================

const batchJobLookups = [
  // Batch job statuses
  { type: 'batch_job_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_job_status', code: 'processing', displayName: 'Processing', color: '#3B82F6', icon: 'loader', sortOrder: 2, isActive: true },
  { type: 'batch_job_status', code: 'awaiting_responses', displayName: 'Awaiting Responses', color: '#8B5CF6', icon: 'inbox', sortOrder: 3, isActive: true },
  { type: 'batch_job_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check-circle', sortOrder: 4, isActive: true },
  { type: 'batch_job_status', code: 'completed_with_warnings', displayName: 'Completed with Warnings', color: '#F59E0B', icon: 'alert-triangle', sortOrder: 5, isActive: true },
  { type: 'batch_job_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x-circle', sortOrder: 6, isActive: true },
  { type: 'batch_job_status', code: 'cancelled', displayName: 'Cancelled', color: '#9CA3AF', icon: 'ban', sortOrder: 7, isActive: true },
  { type: 'batch_job_status', code: 'manual_review', displayName: 'Manual Review', color: '#EC4899', icon: 'user-check', sortOrder: 8, isActive: true },

  // Batch item statuses
  { type: 'batch_item_status', code: 'pending', displayName: 'Pending', color: '#6B7280', icon: 'clock', sortOrder: 1, isActive: true },
  { type: 'batch_item_status', code: 'received', displayName: 'Received', color: '#3B82F6', icon: 'inbox', sortOrder: 2, isActive: true },
  { type: 'batch_item_status', code: 'processing', displayName: 'Processing', color: '#8B5CF6', icon: 'loader', sortOrder: 3, isActive: true },
  { type: 'batch_item_status', code: 'completed', displayName: 'Completed', color: '#10B981', icon: 'check', sortOrder: 4, isActive: true },
  { type: 'batch_item_status', code: 'failed', displayName: 'Failed', color: '#EF4444', icon: 'x', sortOrder: 5, isActive: true },
  { type: 'batch_item_status', code: 'skipped', displayName: 'Skipped', color: '#9CA3AF', icon: 'skip-forward', sortOrder: 6, isActive: true },

  // Review decisions
  { type: 'review_decision', code: 'approved', displayName: 'Approved', color: '#10B981', icon: 'check', sortOrder: 1, isActive: true },
  { type: 'review_decision', code: 'rejected', displayName: 'Rejected', color: '#EF4444', icon: 'x', sortOrder: 2, isActive: true },
  { type: 'review_decision', code: 'proceed_with_partial', displayName: 'Proceed with Partial', color: '#F59E0B', icon: 'alert-circle', sortOrder: 3, isActive: true },
];

db.lookups.insertMany(batchJobLookups);

// ============================================================================
// SAMPLE BATCH JOBS - Example batch processing scenarios
// ============================================================================

// Example 1: Completed email analysis batch
const batchJob1Id = ObjectId();
const batchJob1 = {
  _id: batchJob1Id,
  name: 'Email Sentiment Analysis - October 2024',
  type: 'email_analysis',
  workflowId: null,
  workflowStepId: null,
  taskId: null,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob1Id.toString() + '/callback',
  callbackSecret: 'whsec_example_secret_for_demo_purposes_only',
  status: 'completed',
  expectedCount: 100,
  receivedCount: 100,
  processedCount: 97,
  failedCount: 3,
  minSuccessPercent: 90,
  deadlineAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  inputPayload: {
    sourceFolder: 'inbox/october',
    analysisType: 'sentiment',
    categories: ['positive', 'negative', 'neutral', 'urgent']
  },
  aggregateResult: {
    totalItems: 100,
    successfulCount: 97,
    failedCount: 3,
    successRate: 97,
    results: [
      { itemKey: 'email_001', externalId: 'msg_abc123', data: { sentiment: 'positive', confidence: 0.92 } },
      { itemKey: 'email_002', externalId: 'msg_def456', data: { sentiment: 'neutral', confidence: 0.78 } }
    ],
    errors: [
      { itemKey: 'email_098', externalId: 'msg_xyz999', error: 'Content too short for analysis' }
    ],
    aggregatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000)
  },
  isResultSealed: true,
  requiresManualReview: false,
  createdById: userIds[0],
  createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
  startedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000 + 60000),
  completedAt: new Date(now.getTime() - 23 * 60 * 60 * 1000)
};

// Example 2: In-progress batch job
const batchJob2Id = ObjectId();
const batchJob2 = {
  _id: batchJob2Id,
  name: 'Document Classification Batch',
  type: 'document_classification',
  workflowId: workflowIds[0],
  workflowStepId: 'foreach_classify',
  taskId: rootTask1Id,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob2Id.toString() + '/callback',
  callbackSecret: 'whsec_' + ObjectId().toString(),
  status: 'awaiting_responses',
  expectedCount: 50,
  receivedCount: 32,
  processedCount: 30,
  failedCount: 2,
  minSuccessPercent: 80,
  deadlineAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
  inputPayload: {
    documentSource: 's3://documents/incoming',
    classificationModel: 'gpt-4-classification',
    outputFormat: 'json'
  },
  aggregateResult: null,
  isResultSealed: false,
  requiresManualReview: false,
  createdById: userIds[1],
  createdAt: new Date(now.getTime() - 60 * 60 * 1000),
  updatedAt: now,
  startedAt: new Date(now.getTime() - 55 * 60 * 1000),
  completedAt: null
};

// Example 3: Batch job requiring manual review
const batchJob3Id = ObjectId();
const batchJob3 = {
  _id: batchJob3Id,
  name: 'Customer Data Validation',
  type: 'data_validation',
  workflowId: null,
  workflowStepId: null,
  taskId: null,
  callbackUrl: 'http://localhost:3001/api/batch-jobs/' + batchJob3Id.toString() + '/callback',
  callbackSecret: 'whsec_' + ObjectId().toString(),
  status: 'manual_review',
  expectedCount: 200,
  receivedCount: 200,
  processedCount: 140,
  failedCount: 60,
  minSuccessPercent: 95,
  deadlineAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
  inputPayload: {
    dataSource: 'customer_database',
    validationRules: ['email_format', 'phone_format', 'address_complete']
  },
  aggregateResult: {
    totalItems: 200,
    successfulCount: 140,
    failedCount: 60,
    successRate: 70,
    results: [],
    errors: [
      { itemKey: 'cust_001', error: 'Invalid email format' },
      { itemKey: 'cust_015', error: 'Missing phone number' }
    ],
    aggregatedAt: now
  },
  isResultSealed: false,
  requiresManualReview: true,
  createdById: userIds[0],
  createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
  updatedAt: now,
  startedAt: new Date(now.getTime() - 2.5 * 60 * 60 * 1000),
  completedAt: null
};

db.batch_jobs.insertMany([batchJob1, batchJob2, batchJob3]);

// Sample batch items for the in-progress batch job
const batchItems = [];
for (let i = 1; i <= 32; i++) {
  batchItems.push({
    batchJobId: batchJob2Id,
    itemKey: 'doc_' + String(i).padStart(3, '0'),
    externalId: 'file_' + ObjectId().toString().substring(0, 8),
    status: i <= 30 ? 'completed' : 'failed',
    inputData: {
      filename: 'document_' + i + '.pdf',
      size: Math.floor(Math.random() * 1000000) + 10000
    },
    resultData: i <= 30 ? {
      classification: ['invoice', 'contract', 'report', 'memo'][Math.floor(Math.random() * 4)],
      confidence: 0.7 + Math.random() * 0.3
    } : null,
    error: i > 30 ? 'Unable to parse document format' : null,
    attempts: 1,
    createdAt: new Date(now.getTime() - 55 * 60 * 1000),
    receivedAt: new Date(now.getTime() - (55 - i) * 60 * 1000),
    completedAt: new Date(now.getTime() - (54 - i) * 60 * 1000)
  });
}

db.batch_items.insertMany(batchItems);

print('Seed data inserted successfully!');
